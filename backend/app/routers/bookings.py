import random
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.court import AvailableCourtSlot
from app.models.order import CourtOrder
from app.models.user import User

router = APIRouter(prefix="/bookings", tags=["bookings"])

SUBSCRIPTION_TYPE = "מנוי"
CREDIT_TYPE = "זיכוי"


def _issue_cancellation_credit(order: CourtOrder, db: Session) -> None:
    """
    On cancellation, grant the user a 1-punch credit ticket (זיכוי) for the
    club — unless the booking was paid with a subscription (מנוי) ticket.
    Mirrors AvailableCourtsSearchController.deleteOrder().
    """
    from app.models.ticket import ClubTicket, CustomerTicket

    ct = order.customer_ticket
    is_subscription = (
        ct is not None
        and ct.club_ticket is not None
        and (ct.club_ticket.ticket_type or "").strip() == SUBSCRIPTION_TYPE
    )
    if is_subscription:
        return

    slot = order.slot
    if not slot or not slot.rental_template:
        return
    club = slot.rental_template.club
    if not club:
        return

    credit_product = db.query(ClubTicket).filter(
        ClubTicket.club_id == club.id,
        ClubTicket.ticket_type == CREDIT_TYPE,
    ).first()
    if not credit_product:
        return  # club has no credit product configured

    db.add(CustomerTicket(
        user_id=order.user_id,
        club_ticket_id=credit_product.id,
        cur_num_of_punches=1,
        end_date=date.today() + timedelta(days=365 * 10),
    ))


def _refund_eligible(order: CourtOrder) -> bool:
    """
    A completed order the user may request a refund (זיכוי) for:
      • paid by credit card with amount > 0, OR
      • paid by כרטיסייה that is NOT a subscription (מנוי).
    Subscription bookings and free (amount 0) card bookings are not eligible.
    """
    if order.is_final != "Y":
        return False
    if order.customer_ticket_id is None:            # credit card
        return (order.amount or 0) > 0
    ct = order.customer_ticket                       # ticket payment
    ticket_type = (ct.club_ticket.ticket_type or "").strip() if ct and ct.club_ticket else ""
    return ticket_type != SUBSCRIPTION_TYPE


def _cancel_deadline(order: CourtOrder) -> datetime | None:
    """
    Latest moment the user may cancel, per the club's policy
    (club.min_hour_for_cancel hours before the booking start). None = no policy
    configured → cancellable any time.
    """
    slot = order.slot
    tmpl = slot.rental_template if slot else None
    club = tmpl.club if tmpl else None
    if not slot or not club or not club.min_hour_for_cancel:
        return None
    booking_dt = datetime.combine(slot.curdate, time(hour=slot.hour, minute=(tmpl.minutes_offset or 0)))
    return booking_dt - timedelta(hours=club.min_hour_for_cancel)


def _booking_started(order: CourtOrder) -> bool:
    """Past/future cutoff by the hour, not the date: a booking is 'past' from its
    start time onward (a 09:00 booking is past from 09:00, not from midnight)."""
    slot = order.slot
    if not slot:
        return False
    tmpl = slot.rental_template
    start = datetime.combine(slot.curdate, time(hour=slot.hour, minute=(tmpl.minutes_offset or 0) if tmpl else 0))
    return start < datetime.now()


class BookingOut(BaseModel):
    id: int
    order_id: int
    club_name: str
    court_number: int
    date: date
    hour: int
    minutes_offset: int = 0
    amount: float | None
    is_final: str | None
    refund_eligible: bool = False
    cancel_until: datetime | None = None   # latest time to cancel (club policy); null = anytime

    class Config:
        from_attributes = True


class CreateBookingRequest(BaseModel):
    slot_id: int
    payment_type: int          # 1 = credit card, 2 = ticket
    customer_ticket_id: int | None = None


@router.post("", response_model=BookingOut, status_code=201)
def create_booking(req: CreateBookingRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    slot = db.query(AvailableCourtSlot).filter(
        AvailableCourtSlot.id == req.slot_id,
        AvailableCourtSlot.taken.is_(None),
    ).first()
    if not slot:
        raise HTTPException(status_code=409, detail="Court slot is no longer available")

    template = slot.rental_template
    amount = template.non_member_price

    order = CourtOrder(
        user_id=current_user.id,
        order_id=random.randint(100000, 999999),
        is_final=None,  # pending until payment confirmed
        order_date=date.today(),
        amount=amount,
        customer_ticket_id=req.customer_ticket_id,
    )
    db.add(order)
    db.flush()

    slot.taken = datetime.now(timezone.utc)
    slot.order_id = order.id
    db.commit()
    db.refresh(order)

    return BookingOut(
        id=order.id,
        order_id=order.order_id,
        club_name=template.club.club_name,
        court_number=template.court_number,
        date=slot.curdate,
        hour=slot.hour,
        minutes_offset=template.minutes_offset or 0,
        amount=order.amount,
        is_final=order.is_final,
    )


def _booking_out(order: CourtOrder) -> BookingOut:
    slot = order.slot
    template = slot.rental_template if slot else None
    return BookingOut(
        id=order.id,
        order_id=order.order_id,
        club_name=template.club.club_name if template else "",
        court_number=template.court_number if template else 0,
        date=slot.curdate if slot else order.order_date,
        hour=slot.hour if slot else 0,
        minutes_offset=(template.minutes_offset or 0) if template else 0,
        amount=order.amount,
        is_final=order.is_final,
        refund_eligible=_refund_eligible(order),
        cancel_until=_cancel_deadline(order),
    )


@router.get("/future", response_model=list[BookingOut])
def list_future_bookings(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    orders = (
        db.query(CourtOrder)
        .filter(CourtOrder.user_id == current_user.id, CourtOrder.is_final == "Y")
        .all()
    )
    return [_booking_out(o) for o in orders if o.slot and not _booking_started(o)]


@router.get("/past", response_model=list[BookingOut])
def list_past_bookings(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    orders = (
        db.query(CourtOrder)
        .filter(CourtOrder.user_id == current_user.id, CourtOrder.is_final == "Y")
        .all()
    )
    return [_booking_out(o) for o in orders if o.slot and _booking_started(o)]


@router.get("/my")
def list_my_bookings(future: bool = True, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    orders = db.query(CourtOrder).filter(CourtOrder.user_id == current_user.id, CourtOrder.is_final == "Y").all()
    filtered = [o for o in orders if o.slot and (not _booking_started(o) if future else _booking_started(o))]
    return [_booking_out(o) for o in filtered]


class RefundRequestBody(BaseModel):
    reason: str


@router.post("/{order_id}/refund-request")
def request_refund(order_id: int, body: RefundRequestBody, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    A user asks the club to refund (זיכוי) a past order, with a reason. Emails the
    club (club.email) with the order details + reason. Does NOT cancel the order
    or issue credit — the club acts on the request. Eligibility mirrors _refund_eligible.
    """
    order = db.query(CourtOrder).filter(
        CourtOrder.id == order_id,
        CourtOrder.user_id == current_user.id,
        CourtOrder.is_final == "Y",
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="הזמנה לא נמצאה")

    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="יש להזין סיבה לבקשת הזיכוי")
    if not _refund_eligible(order):
        raise HTTPException(status_code=400, detail="הזמנה זו אינה זכאית לבקשת זיכוי")

    slot = order.slot
    club = slot.rental_template.club if slot and slot.rental_template else None
    if not club or not club.email:
        raise HTTPException(status_code=400, detail="למועדון לא הוגדרה כתובת דוא\"ל לשליחת הבקשה")

    from app.services.email import send_refund_request
    if not send_refund_request(order, reason):
        raise HTTPException(status_code=502, detail="שליחת הבקשה נכשלה. נסו שוב מאוחר יותר.")

    return {"message": "בקשת הזיכוי נשלחה למנהל המועדון."}


class CreateBookingRequest2(BaseModel):
    slot_id: int
    payment_method: str = "credit"
    customer_ticket_id: int | None = None


@router.post("/create")
def create_booking_v2(req: CreateBookingRequest2, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from app.config import settings
    from app.routers.tickets import eligible_tickets_for_slot
    from app.services.pricing import effective_price

    slot = db.query(AvailableCourtSlot).filter(AvailableCourtSlot.id == req.slot_id).first()
    if not slot:
        raise HTTPException(status_code=404, detail="Court slot not found")
    if slot.taken is not None:
        raise HTTPException(status_code=409, detail="Court slot is no longer available")

    template = slot.rental_template
    amount, _is_member = effective_price(db, current_user, slot)

    ticket = None
    if req.payment_method == "ticket":
        if not req.customer_ticket_id:
            raise HTTPException(status_code=400, detail="No ticket selected")
        # Re-run the PaymentController.index() eligibility server-side so a ticket
        # cannot be used outside its ticket_active_time windows (or past the daily
        # order cap) even by calling the API directly.
        eligible, allowed = eligible_tickets_for_slot(db, current_user, slot)
        if not allowed:
            raise HTTPException(status_code=400, detail="הגעת למכסת ההזמנות היומית בכרטיסייה")
        ticket = next((t for t in eligible if t.id == req.customer_ticket_id), None)
        if ticket is None:
            raise HTTPException(status_code=400, detail="הכרטיסייה אינה תקפה ליום ולשעה שנבחרו")

    order = CourtOrder(
        user_id=current_user.id,
        order_id=random.randint(100000, 999999),
        is_final="Y" if req.payment_method == "ticket" else None,
        order_date=date.today(),
        amount=amount,
        customer_ticket_id=req.customer_ticket_id,
    )
    db.add(order)
    db.flush()  # assign order.id so the slot can reference it

    # Atomically claim the slot: only ONE concurrent request whose UPDATE still
    # matches "taken IS NULL" succeeds; the other updates 0 rows and loses.
    # This closes the check-then-act race between two users booking the same slot.
    claimed = (
        db.query(AvailableCourtSlot)
        .filter(AvailableCourtSlot.id == req.slot_id, AvailableCourtSlot.taken.is_(None))
        .update(
            {"taken": datetime.now(timezone.utc), "order_id": order.id},
            synchronize_session=False,
        )
    )
    if claimed == 0:
        db.rollback()  # discards the pending order too — nothing is left behind
        raise HTTPException(status_code=409, detail="Court slot is no longer available")

    # Decrement the ticket's punch balance by 1 (unless unlimited -1000).
    # Mirrors PaymentController.updateNumOfPunches().
    if ticket is not None and ticket.cur_num_of_punches != -1000:
        ticket.cur_num_of_punches = (ticket.cur_num_of_punches or 0) - 1

    db.commit()
    db.refresh(order)

    from app.services.email import send_booking_confirmation_cc, send_booking_confirmation_ticket

    if req.payment_method == "credit":
        club = template.club
        # amount == 0 → free (club member with member_price 0): confirm with no payment
        if amount == 0 or settings.dev_mode or not club or not club.u_name:
            order.is_final = "Y"
            db.commit()
            send_booking_confirmation_cc(order)          # paid by credit card (or free)
            return {"order_id": order.id, "confirmed": True, "message": "Booking confirmed"}
        from app.services.payment import build_pelecard_iframe
        iframe_html = build_pelecard_iframe(order.order_id, float(amount), club.u_name.strip(), 2)
        return {"order_id": order.id, "iframe_html": iframe_html}

    # paid with a ticket — already final; send the confirmation
    send_booking_confirmation_ticket(order)
    return {"order_id": order.id, "confirmed": True, "message": "Booking confirmed"}


@router.post("/{order_id}/cancel")
def cancel_booking_post(order_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    order = db.query(CourtOrder).filter(
        CourtOrder.id == order_id, CourtOrder.user_id == current_user.id, CourtOrder.is_final == "Y"
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Booking not found")

    # Enforce the club's cancellation policy (matches the deadline shown in the UI).
    deadline = _cancel_deadline(order)
    if deadline and datetime.now() > deadline:
        raise HTTPException(
            status_code=400,
            detail=f"עבר המועד האחרון לביטול הזמנה זו ({deadline:%d/%m/%Y %H:%M}).",
        )

    slot = order.slot
    from app.services.email import send_cancellation_email
    send_cancellation_email(order, is_user=True)   # to the user: "ביטול הזמנה"
    _issue_cancellation_credit(order, db)
    order.is_final = "C"
    if slot:
        slot.taken = None
        slot.order_id = None
    db.commit()
    return {"message": "Cancelled"}


@router.delete("/{order_id}")
def cancel_booking(order_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    order = db.query(CourtOrder).filter(
        CourtOrder.id == order_id,
        CourtOrder.user_id == current_user.id,
        CourtOrder.is_final == "Y",
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Booking not found")

    slot = order.slot
    if not slot:
        raise HTTPException(status_code=400, detail="Booking has no associated slot")

    club = slot.rental_template.club
    booking_dt = datetime.combine(slot.curdate, datetime.min.time().replace(hour=slot.hour))
    hours_until = (booking_dt - datetime.now()).total_seconds() / 3600

    if club.min_hour_for_cancel and hours_until < club.min_hour_for_cancel:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel within {club.min_hour_for_cancel} hours of booking"
        )

    from app.services.email import send_cancellation_email
    send_cancellation_email(order, is_user=True)   # to the user: "ביטול הזמנה"
    order.is_final = "C"
    slot.taken = None
    slot.order_id = None
    db.commit()

    # TODO: send cancellation SMS via services (gate/manager) once SMS is wired
    return {"message": "Booking cancelled"}
