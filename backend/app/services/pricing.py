"""
Club-member pricing.

A user granted the "חבר מועדון" privilege (a club_customer_permitted_ticket row
with ticket_type = MEMBER_TYPE, written via the ניהול הרשאות GUI) pays the slot's
member_price instead of non_member_price. member_price may be 0 → the booking is free.
"""
from datetime import date

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.ticket import ClubCustomerPermittedTicket

MEMBER_TYPE = "חבר מועדון"  # club-member pricing privilege (pay member_price)


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


def effective_price(db: Session, user, slot) -> tuple[int, bool]:
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
