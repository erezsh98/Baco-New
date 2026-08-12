from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.club import Club
from app.models.court import AvailableCourtSlot
from app.models.order import CourtOrder
from app.models.ticket import (
    ClubTicket,
    CustomerTicket,
    ClubCustomerPermittedTicket,
    TicketActiveTime,
)
from app.models.user import User

router = APIRouter(prefix="/tickets", tags=["tickets"])

# Placeholder end-date marking a ticket that has been created but not yet paid.
# Matches the old Grails "default date" sentinel (1980-01-01).
UNPAID_DATE = date(1980, 1, 1)
SUBSCRIPTION_TYPE = "מנוי"
from app.services.pricing import MEMBER_TYPE  # "חבר מועדון" — club-member pricing privilege
UNLIMITED_PUNCHES = -1000  # ClubTicket.total_num_of_punches sentinel for unlimited
NO_DAILY_LIMIT = -1        # ClubTicket.max_orders_per_day sentinel for no limit


def day_of_week(d: date) -> int:
    """Day number 1=Sunday .. 7=Saturday, matching Grails PaymentController.getDayOfWeek()."""
    return (d.isoweekday() % 7) + 1


def _member_ticket(db: Session, user: User, club: Club, on_date: date | None = None) -> CustomerTicket | None:
    """
    Find a subscription (מנוי) ticket for the user at this club that is valid on
    on_date (the slot's date). Matched by ticket_type and end_date; a subscription
    is NOT subject to the active-time windows. A subscription ending 2026-08-17
    does not cover a booking for 2026-08-20.
    """
    ref = on_date or date.today()
    return (
        db.query(CustomerTicket)
        .join(ClubTicket, CustomerTicket.club_ticket_id == ClubTicket.id)
        .filter(
            CustomerTicket.user_id == user.id,
            ClubTicket.club_id == club.id,
            func.trim(ClubTicket.ticket_type) == SUBSCRIPTION_TYPE,
            CustomerTicket.end_date >= ref,
        )
        .first()
    )


def _orders_today(db: Session, customer_ticket: CustomerTicket, slot: AvailableCourtSlot) -> int:
    """Count confirmed orders paid with this ticket on the slot's date.
    Mirrors PaymentController.getNumOfOrdersToday()."""
    return (
        db.query(AvailableCourtSlot)
        .join(CourtOrder, AvailableCourtSlot.order_id == CourtOrder.id)
        .filter(
            AvailableCourtSlot.curdate == slot.curdate,
            AvailableCourtSlot.taken.isnot(None),
            CourtOrder.is_final == "Y",
            CourtOrder.customer_ticket_id == customer_ticket.id,
        )
        .count()
    )


def eligible_tickets_for_slot(
    db: Session, user: User, slot: AvailableCourtSlot
) -> tuple[list[CustomerTicket], bool]:
    """
    Which of the user's כרטיסיות may pay for this specific court slot.
    Faithful port of PaymentController.index() ticket-selection logic.

    Returns (tickets, allowed):
      - A subscription (מנוי) ticket, if one exists, is the ONLY option and
        bypasses the active-time windows. `allowed` is False when it has hit
        its max_orders_per_day for the slot's date (old app blocked the order).
      - Otherwise, punch-card tickets filtered by ticket_active_time for the
        slot's day-of-week and hour (holiday counts as day 7 / Saturday),
        with punches remaining or an unlimited product still in its end_date.
    """
    template = slot.rental_template
    club = template.club if template else None
    if club is None:
        return [], True

    member = _member_ticket(db, user, club, slot.curdate)
    if member is not None:
        allowed = True
        max_per_day = member.club_ticket.max_orders_per_day if member.club_ticket else NO_DAILY_LIMIT
        num_today = _orders_today(db, member, slot)
        if num_today > 0 and max_per_day != NO_DAILY_LIMIT and num_today >= max_per_day:
            allowed = False
        return [member], allowed

    dow = 7 if slot.is_holiday == "Y" else day_of_week(slot.curdate)

    active_ticket_ids = (
        db.query(TicketActiveTime.club_ticket_id)
        .filter(
            TicketActiveTime.day_of_week == dow,
            TicketActiveTime.start_hour <= slot.hour,
            TicketActiveTime.end_hour >= slot.hour,
        )
    )

    today = date.today()
    tickets = (
        db.query(CustomerTicket)
        .join(ClubTicket, CustomerTicket.club_ticket_id == ClubTicket.id)
        .filter(
            CustomerTicket.user_id == user.id,
            ClubTicket.club_id == club.id,
            or_(
                CustomerTicket.cur_num_of_punches > 0,
                and_(
                    ClubTicket.total_num_of_punches == UNLIMITED_PUNCHES,
                    CustomerTicket.end_date > slot.curdate,
                ),
            ),
            ClubTicket.id.in_(active_ticket_ids),
            CustomerTicket.end_date > today,
        )
        .all()
    )
    return tickets, True


class ClubTicketOut(BaseModel):
    id: int
    club_id: int
    description: str | None
    ticket_cost: float | None
    total_num_of_punches: int | None
    ticket_type: str | None
    end_date: date | None

    class Config:
        from_attributes = True


class CustomerTicketOut(BaseModel):
    id: int
    club_ticket_id: int
    cur_num_of_punches: int | None
    end_date: date | None
    ticket_type: str | None

    class Config:
        from_attributes = True


@router.get("/club/{club_id}", response_model=list[ClubTicketOut])
def list_club_tickets(club_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(ClubTicket).filter(ClubTicket.club_id == club_id, ClubTicket.end_date >= date.today()).all()


@router.get("/my")
def list_my_tickets(club_id: int | None = None, include_all: bool = False, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    today = date.today()
    query = db.query(CustomerTicket).filter(CustomerTicket.user_id == current_user.id)
    # By default return only valid (in-date, punches remaining) tickets.
    # include_all=true also returns used-up / expired tickets, each flagged is_valid.
    if not include_all:
        query = query.filter(
            CustomerTicket.end_date >= today,
            CustomerTicket.cur_num_of_punches > 0,
        )
    tickets = query.all()
    result = []
    for t in tickets:
        ct = t.club_ticket
        if not ct:
            continue
        if club_id and ct.club_id != club_id:
            continue
        unlimited = ct.total_num_of_punches == UNLIMITED_PUNCHES
        punches_left = t.cur_num_of_punches or 0
        not_expired = t.end_date is not None and t.end_date >= today
        is_valid = not_expired and (unlimited or punches_left > 0)
        result.append({
            "id": t.id,
            "club_ticket_id": t.club_ticket_id,
            "ticket_name": ct.description or "",
            "club_name": ct.club.club_name if ct.club else "",
            "total_punches": ct.total_num_of_punches or 0,
            "punches_left": punches_left,
            "valid_until": str(t.end_date),
            "unlimited": unlimited,
            "is_valid": is_valid,
        })
    return result


@router.get("/for-slot")
def tickets_for_slot(slot_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    The user's כרטיסיות that may pay for a specific court slot, honouring the
    ticket_active_time day/hour windows. Replaces the club-only /tickets/my
    query the payment page used, restoring PaymentController.index() behaviour.

    `order_limit` is True when a subscription ticket has reached its daily order
    cap for the slot's date — the old app blocked the order entirely in that case.
    """
    slot = db.query(AvailableCourtSlot).filter(AvailableCourtSlot.id == slot_id).first()
    if not slot:
        raise HTTPException(status_code=404, detail="Court slot not found")

    tickets, allowed = eligible_tickets_for_slot(db, current_user, slot)
    result = []
    for t in tickets:
        ct = t.club_ticket
        unlimited = bool(ct and ct.total_num_of_punches == UNLIMITED_PUNCHES)
        result.append({
            "id": t.id,
            "club_ticket_id": t.club_ticket_id,
            "ticket_name": (ct.description if ct else "") or "",
            "unlimited": unlimited,
            "punches_left": None if unlimited else (t.cur_num_of_punches or 0),
        })
    return {"order_limit": not allowed, "tickets": result}


@router.get("/packages")
def list_packages(club_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Tickets the user is allowed to buy for this club.
    Mirrors the old TicketPurchaseController.getRelevantTicketsList():
      - the ticket is still valid (end_date in the future, or null)
      - the (club, ticket_type) is permitted for this user (or public, user_id null)
        via ClubCustomerPermittedTicket, with a non-expired permission
      - subscription tickets ("מנוי") are excluded
    """
    today = date.today()

    permitted_types = (
        db.query(ClubCustomerPermittedTicket.ticket_type)
        .filter(
            ClubCustomerPermittedTicket.club_id == club_id,
            or_(
                ClubCustomerPermittedTicket.user_id == current_user.id,
                ClubCustomerPermittedTicket.user_id.is_(None),
            ),
            or_(
                ClubCustomerPermittedTicket.end_date.is_(None),
                ClubCustomerPermittedTicket.end_date > today,
            ),
            ClubCustomerPermittedTicket.ticket_type != SUBSCRIPTION_TYPE,
            ClubCustomerPermittedTicket.ticket_type != MEMBER_TYPE,  # pricing privilege, not a purchasable ticket
        )
        .distinct()
        .all()
    )
    allowed = {t[0] for t in permitted_types}
    if not allowed:
        return []

    tickets = (
        db.query(ClubTicket)
        .filter(
            ClubTicket.club_id == club_id,
            or_(ClubTicket.end_date.is_(None), ClubTicket.end_date > today),
            ClubTicket.ticket_type.in_(allowed),
        )
        .all()
    )
    return [
        {
            "id": t.id,
            "ticket_name": t.description or "",
            "num_of_punches": t.total_num_of_punches,
            "price": t.ticket_cost or 0,
            "valid_days": 365 * 10,
        }
        for t in tickets
    ]


class PurchaseBody(BaseModel):
    club_ticket_id: int


@router.post("/purchase", status_code=201)
def purchase_ticket_body(body: PurchaseBody, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Create a pending CustomerTicket (placeholder end-date) and return the
    Pelecard payment iframe. The ticket is finalized in the pelecard-ticket-good
    callback once payment is approved. Mirrors TicketPurchaseController.PurchaseTicket().
    """
    club_ticket = db.query(ClubTicket).filter(ClubTicket.id == body.club_ticket_id).first()
    if not club_ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    from app.config import settings
    from datetime import timedelta

    club = db.query(Club).filter(Club.id == club_ticket.club_id).first()

    customer_ticket = CustomerTicket(
        user_id=current_user.id,
        club_ticket_id=club_ticket.id,
        cur_num_of_punches=club_ticket.total_num_of_punches,
        end_date=UNPAID_DATE,
    )
    db.add(customer_ticket)
    db.commit()
    db.refresh(customer_ticket)

    # Local dev / no Pelecard merchant configured: confirm the purchase immediately.
    if settings.dev_mode or not club or not club.u_name:
        if club_ticket.total_num_of_punches != -1000:
            customer_ticket.end_date = date.today() + timedelta(days=365 * 10)
        else:
            customer_ticket.end_date = date.today() + timedelta(days=365)
        customer_ticket.ticket_cost = club_ticket.ticket_cost
        customer_ticket.approval_number = "DEV"
        db.commit()
        from app.services.email import send_ticket_purchase_confirmation
        send_ticket_purchase_confirmation(customer_ticket)
        return {"confirmed": True, "customer_ticket_id": customer_ticket.id, "message": "Ticket purchased"}

    from app.services.payment import build_pelecard_iframe
    iframe = build_pelecard_iframe(
        order_id=customer_ticket.id,
        amount_nis=float(club_ticket.ticket_cost or 0),
        club_uname=club.u_name.strip(),
        purchase_type=1,
    )
    return {"iframe_html": iframe, "customer_ticket_id": customer_ticket.id, "message": "Proceed to payment"}


@router.post("/purchase/{club_ticket_id}", status_code=201)
def purchase_ticket(club_ticket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    club_ticket = db.query(ClubTicket).filter(ClubTicket.id == club_ticket_id).first()
    if not club_ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    customer_ticket = CustomerTicket(
        user_id=current_user.id,
        club_ticket_id=club_ticket_id,
        cur_num_of_punches=club_ticket.total_num_of_punches,
        end_date=club_ticket.end_date,
        ticket_cost=club_ticket.ticket_cost,
    )
    db.add(customer_ticket)
    db.commit()
    db.refresh(customer_ticket)
    return {"customer_ticket_id": customer_ticket.id, "message": "Proceed to payment"}
