"""
Club-member pricing.

A user granted the "חבר מועדון" privilege (a club_customer_permitted_ticket row
with ticket_type = MEMBER_TYPE, written via the ניהול הרשאות GUI) pays the slot's
member_price instead of non_member_price. member_price may be 0 → the booking is free.
"""
from datetime import date, datetime

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models.ticket import ClubCustomerPermittedTicket, ClubTicket, CustomerTicket

MEMBER_TYPE = "חבר מועדון"      # club-member pricing privilege (pay member_price)
SUBSCRIPTION_TYPE = "מנוי"      # subscription ticket — books slots at no per-booking cost


def _as_date(v):
    """Normalize a DB value to a plain date.

    In production the end_date columns are DATETIME (dev was DATE), and
    func.max() isn't type-coerced by SQLAlchemy, so it comes back as a
    datetime. Comparing datetime with date raises TypeError — coerce first.
    """
    return v.date() if isinstance(v, datetime) else v


def has_subscription_on(db: Session, user_id: int | None, club_id: int, on_date: date) -> bool:
    """True if the user holds a מנוי (subscription) for this club that is valid
    ON on_date — i.e. its end_date has not passed by the booking date. A slot on
    2026-08-20 is NOT covered by a subscription that ends 2026-08-17."""
    if not user_id:
        return False
    row = (
        db.query(CustomerTicket.id)
        .join(ClubTicket, CustomerTicket.club_ticket_id == ClubTicket.id)
        .filter(
            CustomerTicket.user_id == user_id,
            ClubTicket.club_id == club_id,
            func.trim(ClubTicket.ticket_type) == SUBSCRIPTION_TYPE,
            CustomerTicket.end_date >= on_date,
        )
        .first()
    )
    return row is not None


def subscription_end_by_club(db: Session, user_id: int | None) -> dict[int, date]:
    """
    Map club_id -> latest מנוי end_date, for subscriptions that still have some
    remaining validity (end_date >= today). A slot at that club is covered by the
    subscription only when slot.curdate <= end_date. Empty for anonymous users.
    """
    if not user_id:
        return {}
    today = date.today()
    rows = (
        db.query(ClubTicket.club_id, func.max(CustomerTicket.end_date))
        .join(CustomerTicket, CustomerTicket.club_ticket_id == ClubTicket.id)
        .filter(
            CustomerTicket.user_id == user_id,
            func.trim(ClubTicket.ticket_type) == SUBSCRIPTION_TYPE,
        )
        .group_by(ClubTicket.club_id)
        .all()
    )
    return {
        club_id: d
        for club_id, end in rows
        if end is not None and (d := _as_date(end)) >= today
    }


def is_club_member(db: Session, user_id: int | None, club_id: int) -> bool:
    if not user_id:
        return False
    today = date.today()
    row = db.query(ClubCustomerPermittedTicket).filter(
        ClubCustomerPermittedTicket.club_id == club_id,
        ClubCustomerPermittedTicket.user_id == user_id,
        ClubCustomerPermittedTicket.ticket_type == MEMBER_TYPE,
        or_(
            ClubCustomerPermittedTicket.end_date.is_(None),
            ClubCustomerPermittedTicket.end_date >= today,
        ),
    ).first()
    return row is not None


def effective_price(db: Session, user, slot) -> tuple[float, bool]:
    """(price, is_member_price) for this user + slot.

    Club members pay member_price when it is configured (may be 0 = free);
    otherwise the regular non_member_price applies. A NULL member_price means
    "no member rate configured" → fall back to non_member_price.
    """
    tmpl = slot.rental_template
    non_member = tmpl.non_member_price or 0
    if user is not None and tmpl.member_price is not None and is_club_member(db, user.id, tmpl.club_id):
        return tmpl.member_price, True
    return non_member, False
