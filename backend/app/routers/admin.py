from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.auth.dependencies import require_admin, require_club_manager
from app.database import get_db
from app.models.club import Club, ClubManager
from app.models.ticket import ClubCustomerPermittedTicket
from app.models.court import AvailableCourtSlot
from app.models.order import CourtOrder
from app.models.user import User
from app.services import audit
from app.services.scheduler import rebuild


def _order_club(order):
    """(club_id, club_name) for an order via its slot's template, or (None, None)."""
    slot = order.slot
    tmpl = slot.rental_template if slot else None
    club = tmpl.club if tmpl else None
    return (club.id if club else None, club.club_name if club else None)

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_manages(db: Session, user_id: int, club_id: int) -> None:
    """Guard: the acting admin must manage this specific club."""
    if not db.query(ClubManager).filter(
        ClubManager.user_id == user_id, ClubManager.club_id == club_id
    ).first():
        raise HTTPException(status_code=403, detail="Not a manager of this club")


@router.get("/my-clubs")
def my_clubs(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """Clubs the current manager manages (for the club switcher)."""
    rows = db.query(ClubManager).filter(ClubManager.user_id == admin.id).all()
    return [{"id": m.club.id, "club_name": m.club.club_name} for m in rows if m.club]


class OrderOut(BaseModel):
    id: int
    order_id: int
    user_name: str
    club_name: str
    court_number: int
    date: date
    hour: int
    amount: float | None

    class Config:
        from_attributes = True


@router.get("/orders")
def club_orders(
    from_date: date | None = None,
    to_date: date | None = None,
    date: date | None = None,
    db: Session = Depends(get_db),
    manager: ClubManager = Depends(require_club_manager),
):
    if date and not from_date:
        from_date = date
    if date and not to_date:
        to_date = date

    query = (
        db.query(CourtOrder)
        .join(AvailableCourtSlot, CourtOrder.id == AvailableCourtSlot.order_id)
        .filter(CourtOrder.is_final == "Y")
    )
    if from_date:
        query = query.filter(AvailableCourtSlot.curdate >= from_date)
    if to_date:
        query = query.filter(AvailableCourtSlot.curdate <= to_date)

    orders = query.all()
    result = []
    for o in orders:
        slot = o.slot
        if not slot:
            continue
        tmpl = slot.rental_template
        if tmpl.club_id != manager.club_id:
            continue
        status = "canceled" if o.is_final == "C" else "completed" if o.is_final == "Y" else "pending"
        # For a ticket (כרטיסייה) payment, show the per-punch price of that specific
        # ticket = ticket cost / number of punches, at most 1 decimal. Credit-card
        # orders keep the amount charged; an unlimited ticket (מנוי) has no per-punch
        # price → 0.
        if o.customer_ticket_id:
            ct = o.customer_ticket
            club_ticket = ct.club_ticket if ct else None
            cost = ct.ticket_cost if (ct and ct.ticket_cost is not None) else \
                (club_ticket.ticket_cost if club_ticket else None)
            punches = club_ticket.total_num_of_punches if club_ticket else None
            total_price = round(cost / punches, 1) if (cost is not None and punches and punches > 0) else 0
        else:
            total_price = o.amount or 0
        result.append({
            "id": o.id,
            "order_id": o.order_id,
            "user_name": f"{o.user.first_name} {o.user.last_name}",
            "user_phone": o.user.phone_number or "",
            "club_name": tmpl.club.club_name,
            "court_number": tmpl.court_number,
            "date": str(slot.curdate),
            "hour": slot.hour,
            "minutes_offset": tmpl.minutes_offset or 0,
            "total_price": total_price,
            "status": status,
            "payment_method": "ticket" if o.customer_ticket_id else "credit",
        })
    # Sort: date desc, hour desc, court number asc. Stable sorts applied least-
    # significant first (court asc), then the primary keys desc.
    result.sort(key=lambda r: r["court_number"])
    result.sort(key=lambda r: (r["date"], r["hour"]), reverse=True)
    return result


@router.delete("/orders/{order_id}")
def cancel_order(order_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    order = db.query(CourtOrder).filter(CourtOrder.id == order_id, CourtOrder.is_final == "Y").first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    slot = order.slot
    club_id, club_name = _order_club(order)
    from app.services.email import send_cancellation_email
    send_cancellation_email(order, is_user=False)   # to the club: "בקשה לזיכוי"
    order.is_final = "C"
    if slot:
        slot.taken = None
        slot.order_id = None
    audit.record(db, admin, "order.cancel", f"בוטלה הזמנה #{order.order_id}",
                 club_id=club_id, club_name=club_name, detail={"order_id": order.order_id, "id": order.id})
    db.commit()

    # TODO: send cancellation SMS + create credit ticket (not yet ported)
    return {"message": "Order cancelled"}


@router.post("/orders/{order_id}/cancel")
def cancel_order_post(order_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    order = db.query(CourtOrder).filter(CourtOrder.id == order_id, CourtOrder.is_final == "Y").first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    slot = order.slot
    club_id, club_name = _order_club(order)
    from app.services.email import send_cancellation_email
    send_cancellation_email(order, is_user=False)   # to the club: "בקשה לזיכוי"
    order.is_final = "C"
    if slot:
        slot.taken = None
        slot.order_id = None
    audit.record(db, admin, "order.cancel", f"בוטלה הזמנה #{order.order_id}",
                 club_id=club_id, club_name=club_name, detail={"order_id": order.order_id, "id": order.id})
    db.commit()
    return {"message": "Order cancelled"}


SUBSCRIPTION_TYPE = "מנוי"
CREDIT_TYPE = "זיכוי"


@router.get("/clubs/{club_id}/groups")
def get_club_groups(club_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """
    Groups a user can be assigned to: the club's ClubTickets, excluding the
    special '0' and credit ('זיכוי') types. Mirrors the old group dropdown.
    """
    _require_manages(db, admin.id, club_id)
    from app.models.ticket import ClubTicket
    tickets = db.query(ClubTicket).filter(
        ClubTicket.club_id == club_id,
        ClubTicket.ticket_type != "0",
        ClubTicket.ticket_type != CREDIT_TYPE,
    ).all()
    return [
        {"id": t.id, "name": t.description or t.ticket_type, "ticket_type": t.ticket_type}
        for t in tickets
    ]


@router.get("/clubs/{club_id}/users")
def get_club_users(club_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    _require_manages(db, admin.id, club_id)
    from app.models.ticket import ClubTicket
    permits = db.query(ClubCustomerPermittedTicket).filter(
        ClubCustomerPermittedTicket.club_id == club_id
    ).all()
    result = []
    for p in permits:
        u = p.user
        if not u:
            continue
        # resolve a friendly group name from a ClubTicket of the same type
        ticket = db.query(ClubTicket).filter(
            ClubTicket.club_id == club_id,
            ClubTicket.ticket_type == p.ticket_type,
        ).first()
        result.append({
            "id": p.id,
            "user_id": u.id,
            "user_name": f"{u.first_name} {u.last_name}",
            "email": u.username,
            "phone": u.phone_number or "",
            "group": ticket.description if ticket and ticket.description else p.ticket_type,
            "ticket_type": p.ticket_type,
            "end_date": str(p.end_date) if p.end_date else None,
        })
    # Sort by "בתוקף עד" (end_date) descending; rows with no end date (permanent)
    # go last. end_date is an ISO string, so lexicographic order == chronological.
    result.sort(key=lambda r: (r["end_date"] is not None, r["end_date"] or ""), reverse=True)
    return result


class AddUserBody(BaseModel):
    email_or_phone: str
    group_id: int          # ClubTicket id
    end_date: date


@router.post("/clubs/{club_id}/users")
def add_club_user(club_id: int, body: AddUserBody, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """
    Add a user to a club group. Mirrors ClubCustomerPermittedTicketController:
    resolve the user by email (then phone), derive the group's ticket_type,
    reject duplicate active memberships, then create the permission. If the
    group is a subscription (מנוי), also grant an unlimited subscription ticket.
    """
    _require_manages(db, admin.id, club_id)
    from app.models.ticket import ClubTicket, CustomerTicket

    group = db.query(ClubTicket).filter(ClubTicket.id == body.group_id, ClubTicket.club_id == club_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    ticket_type = (group.ticket_type or "").strip()

    # find user by email, then by phone (digits only)
    ident = body.email_or_phone.strip()
    user = db.query(User).filter(User.username == ident).first()
    if not user:
        phone_digits = "".join(ch for ch in ident if ch.isdigit())
        if phone_digits:
            user = db.query(User).filter(User.phone_number == phone_digits).first()
            if not user:
                # tolerate stored phone numbers that contain separators
                candidates = db.query(User).filter(User.phone_number.isnot(None)).all()
                user = next((u for u in candidates if "".join(c for c in (u.phone_number or "") if c.isdigit()) == phone_digits), None)
    if not user:
        raise HTTPException(status_code=404, detail="לא נמצא משתמש")

    today = date.today()
    existing = db.query(ClubCustomerPermittedTicket).filter(
        ClubCustomerPermittedTicket.club_id == club_id,
        ClubCustomerPermittedTicket.user_id == user.id,
        ClubCustomerPermittedTicket.ticket_type == ticket_type,
        or_(
            ClubCustomerPermittedTicket.end_date.is_(None),
            ClubCustomerPermittedTicket.end_date > today,
        ),
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"למשתמש כבר קיים מנוי פעיל בקבוצה זו")

    permit = ClubCustomerPermittedTicket(
        club_id=club_id, user_id=user.id, ticket_type=ticket_type, end_date=body.end_date,
    )
    db.add(permit)

    # Subscription group → also grant an unlimited subscription ticket.
    if ticket_type == SUBSCRIPTION_TYPE:
        db.add(CustomerTicket(
            user_id=user.id,
            club_ticket_id=group.id,
            cur_num_of_punches=-1000,
            end_date=body.end_date,
            approval_number="subscr",
            ticket_cost=group.ticket_cost,
        ))

    group_name = group.description or ticket_type
    club = db.query(Club).filter(Club.id == club_id).first()
    audit.record(
        db, admin, "permission.grant",
        f"הוענקה הרשאה '{group_name}' ל{user.first_name} {user.last_name}"
        + (f" עד {body.end_date:%d/%m/%Y}" if body.end_date else ""),
        club_id=club_id, club_name=(club.club_name if club else None),
        detail={"user_id": user.id, "user_name": f"{user.first_name} {user.last_name}",
                "ticket_type": ticket_type, "group": group_name, "end_date": str(body.end_date)},
    )

    db.commit()

    from app.services.email import send_add_to_group_email
    send_add_to_group_email(user, club, body.end_date, ticket_type)

    return {
        "message": f"המשתמש {user.first_name} {user.last_name} צורף לקבוצה {group.description or ticket_type}",
        "user_name": f"{user.first_name} {user.last_name}",
    }


@router.delete("/permissions/{permit_id}")
def remove_permission(permit_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    p = db.query(ClubCustomerPermittedTicket).filter(ClubCustomerPermittedTicket.id == permit_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    _require_manages(db, admin.id, p.club_id)
    u = p.user
    club = db.query(Club).filter(Club.id == p.club_id).first()
    who = f"{u.first_name} {u.last_name}" if u else f"#{p.user_id}"

    # A subscription (מנוי) membership also granted a CustomerTicket, and THAT row
    # (not the permission) is what search uses to decide coverage. Deleting only
    # the permission left the user still covered until the ticket's end_date.
    # Revoke the matching subscription ticket too: delete it when it was never
    # used, or expire it (end_date = yesterday) when a past booking references it
    # (preserves the FK and the booking history).
    revoked_subs = 0
    if (p.ticket_type or "").strip() == SUBSCRIPTION_TYPE:
        from app.models.ticket import ClubTicket, CustomerTicket
        subs = (
            db.query(CustomerTicket)
            .join(ClubTicket, CustomerTicket.club_ticket_id == ClubTicket.id)
            .filter(
                CustomerTicket.user_id == p.user_id,
                ClubTicket.club_id == p.club_id,
                func.trim(ClubTicket.ticket_type) == SUBSCRIPTION_TYPE,
            )
            .all()
        )
        yesterday = date.today() - timedelta(days=1)
        for ct in subs:
            used = db.query(CourtOrder.id).filter(CourtOrder.customer_ticket_id == ct.id).first()
            if used:
                ct.end_date = yesterday
            else:
                db.delete(ct)
            revoked_subs += 1

    audit.record(
        db, admin, "permission.revoke",
        f"בוטלה הרשאה '{p.ticket_type}' מ{who}",
        club_id=p.club_id, club_name=(club.club_name if club else None),
        detail={"permit_id": permit_id, "user_id": p.user_id, "ticket_type": p.ticket_type,
                "revoked_subscriptions": revoked_subs},
    )
    db.delete(p)
    db.commit()
    return {"message": "Removed"}


class UpdatePermitBody(BaseModel):
    end_date: date


@router.patch("/permissions/{permit_id}")
def update_permission(permit_id: int, body: UpdatePermitBody, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """Update a membership's end date ("בתוקף עד"). For a מנוי membership, keep the
    paired subscription ticket — which drives search coverage — on the same date."""
    p = db.query(ClubCustomerPermittedTicket).filter(ClubCustomerPermittedTicket.id == permit_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    _require_manages(db, admin.id, p.club_id)

    old_end = p.end_date
    p.end_date = body.end_date

    # A מנוי membership's coverage comes from its CustomerTicket, created with the
    # same end_date. Move that ticket to the new date too (match by the old date so
    # we touch only the ticket paired with this membership).
    synced = 0
    if (p.ticket_type or "").strip() == SUBSCRIPTION_TYPE:
        from app.models.ticket import ClubTicket, CustomerTicket
        q = (
            db.query(CustomerTicket)
            .join(ClubTicket, CustomerTicket.club_ticket_id == ClubTicket.id)
            .filter(
                CustomerTicket.user_id == p.user_id,
                ClubTicket.club_id == p.club_id,
                func.trim(ClubTicket.ticket_type) == SUBSCRIPTION_TYPE,
            )
        )
        if old_end is not None:
            q = q.filter(CustomerTicket.end_date == old_end)
        for ct in q.all():
            ct.end_date = body.end_date
            synced += 1

    u = p.user
    club = db.query(Club).filter(Club.id == p.club_id).first()
    who = f"{u.first_name} {u.last_name}" if u else f"#{p.user_id}"
    audit.record(
        db, admin, "permission.update",
        f"עודכן תוקף הרשאה '{p.ticket_type}' של {who} עד {body.end_date:%d/%m/%Y}",
        club_id=p.club_id, club_name=(club.club_name if club else None),
        detail={"permit_id": permit_id, "user_id": p.user_id, "ticket_type": p.ticket_type,
                "old_end_date": str(old_end) if old_end else None,
                "end_date": str(body.end_date), "synced_subscriptions": synced},
    )
    db.commit()
    return {"message": "התאריך עודכן", "end_date": str(body.end_date)}


@router.post("/rebuild")
def trigger_rebuild(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    rebuild(db)
    audit.record(db, admin, "availability.rebuild", "עדכון זמינות מלא (כל המועדונים)")
    db.commit()
    return {"message": "Availability rebuilt"}
