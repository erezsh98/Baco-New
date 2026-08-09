"""
Graphic rental-schedule editor for club managers.

A `rental_template` row defines availability for one court as
(days_str [1=Sun..7=Sat], from_hour..end_hour INCLUSIVE, member/non-member price)
within an effective date range. This router exposes that schedule as a
per-(day, hour) matrix and reconciles edits back into compact template rows,
then rebuilds bookable availability — all scoped to the manager's own club.
Business logic and DB structure are unchanged from the legacy Grails app.
"""
from collections import defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.dependencies import require_club_manager
from app.database import get_db
from app.models.club import Club, ClubManager
from app.models.court import RentalTemplate
from app.services import audit
from app.services.scheduler import rebuild

router = APIRouter(prefix="/admin/schedule", tags=["schedule"])

# Default matrix display window (inclusive), widened to cover any existing data.
DEFAULT_HOUR_FROM = 6
DEFAULT_HOUR_TO = 23


ALLOWED_OFFSETS = {0, 15, 30, 45}


class MatrixCell(BaseModel):
    day: int          # 1=Sunday .. 7=Saturday
    hour: int
    member_price: int
    non_member_price: int
    minutes_offset: int = 0   # slot starts this many minutes after the hour (0/15/30/45)


class MatrixSave(BaseModel):
    court_number: int
    start_date: date
    end_date: date
    price_mode: str = "same"     # "same" | "different" (informational)
    cells: list[MatrixCell]


@router.get("/courts")
def list_courts(db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    """Court numbers the manager can edit (from all templates of their club)."""
    club = db.query(Club).filter(Club.id == manager.club_id).first()
    rows = (
        db.query(RentalTemplate.court_number)
        .filter(RentalTemplate.club_id == manager.club_id)
        .distinct()
        .all()
    )
    courts = sorted({r[0] for r in rows if r[0] is not None})
    return {
        "club_id": manager.club_id,
        "club_name": club.club_name if club else "",
        "courts": courts,
    }


@router.get("/matrix")
def get_matrix(court_number: int, db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    """Expand the court's active templates into a per-(day, hour) availability grid."""
    club = db.query(Club).filter(Club.id == manager.club_id).first()
    templates = (
        db.query(RentalTemplate)
        .filter(
            RentalTemplate.club_id == manager.club_id,
            RentalTemplate.court_number == court_number,
            RentalTemplate.is_active == "Y",
        )
        .all()
    )

    cells: dict[tuple[int, int], tuple[int, int, int]] = {}
    all_prices_equal = True
    for t in templates:
        days = [int(x) for x in (t.days_str or "").split(",") if x.strip()]
        m = t.member_price or 0
        nm = t.non_member_price or 0
        off = t.minutes_offset or 0
        if m != nm:
            all_prices_equal = False
        for d in days:
            for h in range(t.from_hour, t.end_hour + 1):  # end_hour inclusive
                cells[(d, h)] = (m, nm, off)

    if templates:
        start = min(t.start_effective_date for t in templates)
        end = max(t.end_effective_date for t in templates)
    else:
        start = date.today()
        end = date.today() + timedelta(days=365)

    used_hours = [h for (_, h) in cells]
    hour_from = min([DEFAULT_HOUR_FROM] + used_hours)
    hour_to = max([DEFAULT_HOUR_TO] + used_hours)

    return {
        "club_name": club.club_name if club else "",
        "court_number": court_number,
        "start_date": str(start),
        "end_date": str(end),
        "price_mode": "same" if all_prices_equal else "different",
        "hour_from": hour_from,
        "hour_to": hour_to,
        "cells": [
            {"day": d, "hour": h, "member_price": m, "non_member_price": nm, "minutes_offset": off}
            for (d, h), (m, nm, off) in sorted(cells.items())
        ],
    }


def _merge_cells(cells: list[MatrixCell]) -> list[tuple[str, int, int, int, int, int]]:
    """
    Collapse per-cell availability into compact template rows.
    Returns tuples (days_str, from_hour, end_hour, member_price, non_member_price, minutes_offset).

    Per day, contiguous hours sharing the same (price, minutes_offset) become
    one hour-range; then ranges identical in (hours, price, offset) across days
    are merged into one days_str — reproducing the legacy compact "1,2,3" style.
    """
    by_day: dict[int, dict[int, tuple[int, int, int]]] = defaultdict(dict)
    for c in cells:
        by_day[c.day][c.hour] = (c.member_price, c.non_member_price, c.minutes_offset)

    runs: list[tuple[int, int, int, int, int, int]] = []  # day, from, end, m, nm, off
    for day in sorted(by_day):
        hours = by_day[day]
        for hour in sorted(hours):
            m, nm, off = hours[hour]
            last = runs[-1] if runs else None
            if last and last[0] == day and last[2] == hour - 1 and last[3] == m and last[4] == nm and last[5] == off:
                runs[-1] = (last[0], last[1], hour, m, nm, off)
            else:
                runs.append((day, hour, hour, m, nm, off))

    groups: dict[tuple[int, int, int, int, int], list[int]] = defaultdict(list)
    for day, fh, eh, m, nm, off in runs:
        groups[(fh, eh, m, nm, off)].append(day)

    result = []
    for (fh, eh, m, nm, off), days in groups.items():
        days_str = ",".join(str(d) for d in sorted(days))
        result.append((days_str, fh, eh, m, nm, off))
    return result


@router.post("/matrix")
def save_matrix(payload: MatrixSave, db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    """
    Reconcile the edited matrix into rental_template rows for the manager's
    club + court. This PERSISTS the schedule only — it does not rebuild
    bookable availability. The manager applies the change to live slots
    separately via POST /admin/schedule/rebuild ("עדכן מערכת עם השינויים").

    Existing active templates are deactivated (is_active='N') rather than
    deleted, so any already-booked slots that reference them stay intact;
    rebuild() only regenerates from active templates.
    """
    if payload.start_date > payload.end_date:
        raise HTTPException(status_code=400, detail="תאריך התחלה מאוחר מתאריך הסיום")
    for c in payload.cells:
        if not (1 <= c.day <= 7):
            raise HTTPException(status_code=400, detail=f"יום לא תקין: {c.day}")
        if not (0 <= c.hour <= 23):
            raise HTTPException(status_code=400, detail=f"שעה לא תקינה: {c.hour}")
        if c.minutes_offset not in ALLOWED_OFFSETS:
            raise HTTPException(status_code=400, detail=f"היסט דקות לא תקין: {c.minutes_offset}")

    existing = (
        db.query(RentalTemplate)
        .filter(
            RentalTemplate.club_id == manager.club_id,
            RentalTemplate.court_number == payload.court_number,
            RentalTemplate.is_active == "Y",
        )
        .all()
    )
    # Preserve non-matrix attributes (for_member / surface) from the current
    # schedule so they survive the edit. minutes_offset is now per-cell.
    proto = existing[0] if existing else None
    for_member = proto.for_member if proto else None
    surface_type = proto.surface_type if proto else None

    for t in existing:
        t.is_active = "N"

    merged = _merge_cells(payload.cells)
    for days_str, fh, eh, m, nm, off in merged:
        db.add(RentalTemplate(
            club_id=manager.club_id,
            court_number=payload.court_number,
            start_effective_date=payload.start_date,
            end_effective_date=payload.end_date,
            days_str=days_str,
            from_hour=fh,
            end_hour=eh,
            member_price=m,
            non_member_price=nm,
            is_active="Y",
            minutes_offset=off,
            for_member=for_member,
            surface_type=surface_type,
        ))
    created = len(merged)

    club_name = manager.club.club_name if manager.club else None
    audit.record(
        db, manager.user, "schedule.save",
        f"עודכן לוח זמנים — מגרש {payload.court_number}, "
        f"{payload.start_date:%d/%m/%Y}–{payload.end_date:%d/%m/%Y}, {created} תבניות",
        club_id=manager.club_id, club_name=club_name,
        detail={
            "court_number": payload.court_number,
            "start_date": str(payload.start_date),
            "end_date": str(payload.end_date),
            "price_mode": payload.price_mode,
            "templates": [
                {"days": ds, "from_hour": fh, "end_hour": eh,
                 "member_price": m, "non_member_price": nm, "minutes_offset": off}
                for ds, fh, eh, m, nm, off in merged
            ],
        },
    )

    db.commit()

    return {
        "message": 'לוח הזמנים נשמר. לחצו "עדכן מערכת עם השינויים" כדי להחיל על הזמינות.',
        "templates_created": created,
    }


@router.post("/rebuild")
def rebuild_club(db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    """
    Apply saved schedule changes to bookable availability — for THIS manager's
    club only. Regenerates free slots from the club's active templates and
    re-marks holidays, leaving every other club untouched. The daily 01:00 cron
    still rebuilds all clubs globally.
    """
    rebuild(db, club_id=manager.club_id)

    # Housekeeping: now that the rebuild has cleared this club's free slots and
    # regenerated them from active templates, drop deactivated templates that no
    # longer have any slot referencing them. Templates still referenced by a
    # booked slot are kept so history stays intact.
    from app.models.court import AvailableCourtSlot
    referenced = db.query(AvailableCourtSlot.rental_template_id).distinct()
    db.query(RentalTemplate).filter(
        RentalTemplate.club_id == manager.club_id,
        RentalTemplate.is_active == "N",
        RentalTemplate.id.notin_(referenced),
    ).delete(synchronize_session=False)

    from app.models.court import AvailableCourtSlot as _Slot
    free_slots = (
        db.query(func.count(_Slot.id))
        .join(RentalTemplate, _Slot.rental_template_id == RentalTemplate.id)
        .filter(RentalTemplate.club_id == manager.club_id, _Slot.order_id.is_(None))
        .scalar()
    )
    club_name = manager.club.club_name if manager.club else None
    audit.record(
        db, manager.user, "availability.rebuild",
        f"עדכון זמינות למועדון — {free_slots} סלוטים פנויים",
        club_id=manager.club_id, club_name=club_name,
        detail={"free_slots": free_slots},
    )
    db.commit()

    return {"message": "הזמינות עודכנה בהצלחה לפי השינויים האחרונים."}
