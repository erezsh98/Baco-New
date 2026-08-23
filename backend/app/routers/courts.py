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
from app.services.pricing import effective_price, has_subscription_on, subscription_end_by_club

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
    member_price: float | None
    non_member_price: float | None
    price: float        # effective price for the requesting user (member_price for members)
    is_member_price: bool
    is_free: bool       # member_price == 0 → no payment needed
    covered_by_subscription: bool = False   # user holds a מנוי → books free via subscription

    class Config:
        from_attributes = True


def _slot_out(db: Session, slot: AvailableCourtSlot, user: User | None, covered: bool = False) -> "CourtSlotOut":
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
        covered_by_subscription=covered,
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
            # NOTE: intentionally NOT filtering RentalTemplate.is_active here.
            # The generated slots are the applied availability and only change
            # when rebuild() runs. Saving a schedule deactivates the old
            # templates immediately, but the change must not take effect until
            # the manager clicks "עדכן מערכת עם השינויים" (rebuild). Filtering on
            # is_active would hide the current availability during that gap.
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

    # Subscription coverage is per booking DATE: a slot at a club is covered only
    # when its date falls on/before the subscription's end_date.
    sub_end = subscription_end_by_club(db, current_user.id if current_user else None)

    # for_member templates are subscriber-only availability. Users with no live
    # subscription anywhere can never see them, so hide in SQL (fast path). Users
    # who DO hold a subscription are filtered per-date in Python below (a slot
    # past their subscription's end_date is still hidden).
    if not sub_end:
        query = query.filter(RentalTemplate.for_member.is_(None))

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

    def _covered(s: AvailableCourtSlot) -> bool:
        end = sub_end.get(s.rental_template.club_id)
        return end is not None and s.curdate <= end

    result = []
    for s in slots:
        covered = _covered(s)
        # A subscriber-only (for_member) slot on a date the user's subscription
        # no longer covers must stay hidden.
        if s.rental_template.for_member is not None and not covered:
            continue
        result.append(_slot_out(db, s, current_user, covered=covered))
    return result


@router.get("/{slot_id}", response_model=CourtSlotOut)
def get_slot(slot_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from fastapi import HTTPException
    slot = db.query(AvailableCourtSlot).filter(AvailableCourtSlot.id == slot_id).first()
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")
    covered = has_subscription_on(db, current_user.id, slot.rental_template.club_id, slot.curdate)
    return _slot_out(db, slot, current_user, covered=covered)
