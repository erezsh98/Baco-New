from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user, get_current_user_optional
from app.database import get_db
from app.models.court import AvailableCourtSlot, RentalTemplate
from app.models.club import Club
from app.models.user import User
from app.services.pricing import effective_price

router = APIRouter(prefix="/courts", tags=["courts"])


class CourtSlotOut(BaseModel):
    id: int
    club_name: str
    club_id: int
    court_number: int
    surface_type: str | None
    date: date
    hour: int
    minutes_offset: int
    member_price: int | None
    non_member_price: int | None
    price: int          # effective price for the requesting user (member_price for members)
    is_member_price: bool
    is_free: bool       # member_price == 0 → no payment needed

    class Config:
        from_attributes = True


def _slot_out(db: Session, slot: AvailableCourtSlot, user: User | None) -> "CourtSlotOut":
    tmpl = slot.rental_template
    price, is_member = effective_price(db, user, slot)
    return CourtSlotOut(
        id=slot.id,
        club_name=tmpl.club.club_name,
        club_id=tmpl.club.id,
        court_number=tmpl.court_number,
        surface_type=tmpl.surface_type,
        date=slot.curdate,
        hour=slot.hour,
        minutes_offset=tmpl.minutes_offset,
        member_price=tmpl.member_price,
        non_member_price=tmpl.non_member_price,
        price=price,
        is_member_price=is_member,
        is_free=(price == 0),
    )


@router.get("/search", response_model=list[CourtSlotOut])
def search_courts(
    from_date: date = Query(...),
    to_date: date = Query(...),
    from_hour: int = Query(None),
    to_hour: int = Query(None),
    area_id: int = Query(None),
    club_id: int = Query(None),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    query = (
        db.query(AvailableCourtSlot)
        .join(RentalTemplate)
        .join(Club)
        .filter(
            AvailableCourtSlot.taken.is_(None),
            AvailableCourtSlot.is_holiday.is_(None),
            AvailableCourtSlot.curdate >= from_date,
            AvailableCourtSlot.curdate <= to_date,
            RentalTemplate.is_active == "Y",
        )
    )
    if from_hour is not None:
        query = query.filter(AvailableCourtSlot.hour >= from_hour)
    if to_hour is not None:
        query = query.filter(AvailableCourtSlot.hour <= to_hour)
    if area_id:
        query = query.filter(Club.area_id == area_id)
    if club_id:
        query = query.filter(Club.id == club_id)

    # Advance-booking window (legacy AvailableCourtsSearchController): a slot is
    # only offered if it is at least the club's lead time away from now. Base
    # cutoff = now (hides past/current slots); when a specific club is chosen,
    # push it out by rent_threshold_days / rental_threshold_hours.
    now = datetime.now()
    cutoff_date = now.date()
    cutoff_hour = now.hour
    if club_id:
        club = db.query(Club).filter(Club.id == club_id).first()
        if club:
            cutoff_date = now.date() + timedelta(days=club.rent_threshold_days or 0)
            cutoff_hour = now.hour + (club.rental_threshold_hours or 0)
    query = query.filter(
        or_(
            AvailableCourtSlot.curdate > cutoff_date,
            and_(AvailableCourtSlot.curdate == cutoff_date, AvailableCourtSlot.hour > cutoff_hour),
        )
    )

    slots = query.order_by(AvailableCourtSlot.curdate, AvailableCourtSlot.hour).all()

    return [_slot_out(db, s, current_user) for s in slots]


@router.get("/{slot_id}", response_model=CourtSlotOut)
def get_slot(slot_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from fastapi import HTTPException
    slot = db.query(AvailableCourtSlot).filter(AvailableCourtSlot.id == slot_id).first()
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")
    return _slot_out(db, slot, current_user)
