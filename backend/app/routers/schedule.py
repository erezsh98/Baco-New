"""
Graphic rental-schedule editor for club managers.

A `rental_template` row defines availability for one court as
(days_str [1=Sun..7=Sat], from_hour..end_hour INCLUSIVE, member/non-member price)
within an effective date range. This router exposes that schedule as a
per-(day, hour) matrix and reconciles edits back into compact template rows,
then rebuilds bookable availability — all scoped to the manager's own club.

Two editing MODELS, inferred from the data (no extra table):
  * "auto"   (מתחדש אוטומטית / renew): one open-ended schedule per court whose
             end_effective_date is the 2050 sentinel. Always in effect.
  * "period" (תקופה): one or more bounded [start, end] schedules per court.
             All rows sharing the same (start, end) are one period. Periods on
             a court may not overlap in dates.
The model of a court is derived: a set ending in 2050 → auto; otherwise period;
an empty court defaults to auto.
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
from app.models.court import AvailableCourtSlot, RentalTemplate
from app.models.order import CourtOrder
from app.services import audit
from app.services.scheduler import rebuild

router = APIRouter(prefix="/admin/schedule", tags=["schedule"])

# Default matrix display window (inclusive), widened to cover any existing data.
DEFAULT_HOUR_FROM = 6
DEFAULT_HOUR_TO = 23

ALLOWED_OFFSETS = {0, 15, 30, 45}

# Sentinel end date marking a renew ("auto") schedule — effectively "forever".
RENEW_END = date(2050, 12, 31)


def _dow(d: date) -> int:
    """Day-of-week in the app's convention: Sunday=1 .. Saturday=7."""
    return d.isoweekday() % 7 + 1


def _is_renew_end(end: date | None) -> bool:
    return end is not None and end.year >= 2050


def _period_status(start: date, end: date, today: date) -> str:
    if end < today:
        return "ended"      # הסתיים
    if start > today:
        return "future"     # עתידי
    return "active"         # פעיל


# ---------------------------------------------------------------------------
# Model / template helpers
# ---------------------------------------------------------------------------
def _active_templates(db: Session, club_id: int, court: int) -> list[RentalTemplate]:
    return (
        db.query(RentalTemplate)
        .filter(
            RentalTemplate.club_id == club_id,
            RentalTemplate.court_number == court,
            RentalTemplate.is_active == "Y",
        )
        .all()
    )


def _model_of(templates: list[RentalTemplate]) -> str:
    """Infer a court's editing model from its active templates."""
    if not templates:
        return "auto"
    if any(_is_renew_end(t.end_effective_date) for t in templates):
        return "auto"
    return "period"


def _open_cells(templates: list[RentalTemplate]) -> set[tuple[int, int]]:
    """The set of (day, hour) cells covered (open) by these templates."""
    cells: set[tuple[int, int]] = set()
    for t in templates:
        days = [int(x) for x in (t.days_str or "").split(",") if x.strip()]
        for d in days:
            for h in range(t.from_hour, t.end_hour + 1):  # end_hour inclusive
                cells.add((d, h))
    return cells


def _matrix_payload(templates: list[RentalTemplate]) -> dict:
    """Expand templates into a per-(day, hour) grid payload."""
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
            for h in range(t.from_hour, t.end_hour + 1):
                cells[(d, h)] = (m, nm, off)

    used_hours = [h for (_, h) in cells]
    return {
        "price_mode": "same" if all_prices_equal else "different",
        "hour_from": min([DEFAULT_HOUR_FROM] + used_hours),
        "hour_to": max([DEFAULT_HOUR_TO] + used_hours),
        "cells": [
            {"day": d, "hour": h, "member_price": m, "non_member_price": nm, "minutes_offset": off}
            for (d, h), (m, nm, off) in sorted(cells.items())
        ],
    }


def _future_booking_conflicts(
    db: Session, club_id: int, court: int,
    blocked_cells: set[tuple[int, int]],
    date_from: date, date_to: date | None,
) -> list[dict]:
    """
    Confirmed FUTURE reservations that fall on (day, hour) cells about to be
    blocked, within [date_from, date_to]. Used to warn the admin before a save
    removes availability. Bookings are never auto-cancelled — this only reports.
    """
    if not blocked_cells:
        return []
    hours = {h for (_, h) in blocked_cells}
    q = (
        db.query(AvailableCourtSlot, CourtOrder)
        .join(RentalTemplate, AvailableCourtSlot.rental_template_id == RentalTemplate.id)
        .join(CourtOrder, AvailableCourtSlot.order_id == CourtOrder.id)
        .filter(
            RentalTemplate.club_id == club_id,
            RentalTemplate.court_number == court,
            AvailableCourtSlot.order_id.isnot(None),
            CourtOrder.is_final == "Y",
            AvailableCourtSlot.hour.in_(hours),
            AvailableCourtSlot.curdate >= date_from,
        )
    )
    if date_to is not None:
        q = q.filter(AvailableCourtSlot.curdate <= date_to)

    out = []
    for slot, order in q.all():
        if (_dow(slot.curdate), slot.hour) in blocked_cells:
            u = order.user
            out.append({
                "date": str(slot.curdate),
                "hour": slot.hour,
                "order_id": order.order_id,
                "customer": f"{u.first_name} {u.last_name}" if u else "",
            })
    out.sort(key=lambda x: (x["date"], x["hour"]))
    return out


def _merge_cells(cells: list["MatrixCell"]) -> list[tuple[str, int, int, int, int, int]]:
    """
    Collapse per-cell availability into compact template rows.
    Returns tuples (days_str, from_hour, end_hour, member_price, non_member_price, minutes_offset).
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

    return [
        (",".join(str(d) for d in sorted(days)), fh, eh, m, nm, off)
        for (fh, eh, m, nm, off), days in groups.items()
    ]


# ---------------------------------------------------------------------------
# Read endpoints
# ---------------------------------------------------------------------------
@router.get("/courts")
def list_courts(db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    """All court numbers 1..num_of_courts (∪ any court already having templates),
    each with its inferred editing model."""
    club = db.query(Club).filter(Club.id == manager.club_id).first()
    n = (club.num_of_courts or 0) if club else 0
    courts = set(range(1, n + 1))
    rows = db.query(RentalTemplate.court_number).filter(RentalTemplate.club_id == manager.club_id).distinct().all()
    courts |= {r[0] for r in rows if r[0] is not None}
    court_list = sorted(courts) or [1]

    return {
        "club_id": manager.club_id,
        "club_name": club.club_name if club else "",
        "num_of_courts": n,
        "courts": [
            {"court_number": c, "model": _model_of(_active_templates(db, manager.club_id, c))}
            for c in court_list
        ],
    }


@router.get("/court")
def get_court(court_number: int, db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    """A court's model plus its editable content: the renew matrix (auto) or the
    list of periods (period)."""
    club = db.query(Club).filter(Club.id == manager.club_id).first()
    active = _active_templates(db, manager.club_id, court_number)
    model = _model_of(active)
    today = date.today()

    base = {"club_name": club.club_name if club else "", "court_number": court_number, "model": model}

    if model == "auto":
        renew = [t for t in active if _is_renew_end(t.end_effective_date)]
        start = min((t.start_effective_date for t in renew), default=today)
        base.update(_matrix_payload(renew))
        base.update({"start_date": str(start), "end_date": str(RENEW_END)})
        return base

    # period model — list distinct (start, end) sets
    groups: dict[tuple[date, date], int] = defaultdict(int)
    for t in active:
        if _is_renew_end(t.end_effective_date):
            continue
        groups[(t.start_effective_date, t.end_effective_date)] += 1
    periods = [
        {
            "start_date": str(s), "end_date": str(e),
            "status": _period_status(s, e, today),
            "editable": e >= today,
        }
        for (s, e) in sorted(groups)
    ]
    base["periods"] = periods
    return base


@router.get("/matrix")
def get_matrix(
    court_number: int, start: date, end: date,
    db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager),
):
    """Grid cells for ONE schedule set of a court, identified by (start, end).
    Used to edit a period or to seed a new period from an existing one."""
    templates = [
        t for t in _active_templates(db, manager.club_id, court_number)
        if t.start_effective_date == start and t.end_effective_date == end
    ]
    payload = _matrix_payload(templates)
    payload.update({"court_number": court_number, "start_date": str(start), "end_date": str(end)})
    return payload


# ---------------------------------------------------------------------------
# Write endpoints
# ---------------------------------------------------------------------------
class MatrixCell(BaseModel):
    day: int          # 1=Sunday .. 7=Saturday
    hour: int
    member_price: int
    non_member_price: int
    minutes_offset: int = 0   # slot starts this many minutes after the hour (0/15/30/45)


class MatrixSave(BaseModel):
    court_number: int
    model: str = "auto"               # "auto" (renew) | "period"
    start_date: date
    end_date: date
    orig_start: date | None = None    # period edit: identifies the period being replaced
    orig_end: date | None = None
    price_mode: str = "same"
    cells: list[MatrixCell]
    confirm_block_conflicts: bool = False


@router.post("/matrix")
def save_matrix(payload: MatrixSave, db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    """
    Persist ONE schedule set (renew schedule, or one period) into rental_template.
    PERSISTS only — availability is rebuilt separately via POST /admin/schedule/rebuild.

    Old templates are deactivated (is_active='N'), never deleted, so booked slots
    stay intact. Blocking a cell that has a future confirmed booking returns 409
    with the conflicts unless confirm_block_conflicts=True (booking is left intact).
    """
    today = date.today()

    for c in payload.cells:
        if not (1 <= c.day <= 7):
            raise HTTPException(status_code=400, detail=f"יום לא תקין: {c.day}")
        if not (0 <= c.hour <= 23):
            raise HTTPException(status_code=400, detail=f"שעה לא תקינה: {c.hour}")
        if c.minutes_offset not in ALLOWED_OFFSETS:
            raise HTTPException(status_code=400, detail=f"היסט דקות לא תקין: {c.minutes_offset}")

    active = _active_templates(db, manager.club_id, payload.court_number)
    current_model = _model_of(active)
    target_model = payload.model if payload.model in ("auto", "period") else "auto"
    switching = bool(active) and target_model != current_model

    # ---- Resolve which templates to deactivate, the old open-cells, and the
    #      date window for the block-conflict check. ----
    if target_model == "auto":
        # Renew: one open-ended schedule. Start fresh — deactivate everything.
        renew_existing = [t for t in active if _is_renew_end(t.end_effective_date)]
        start_date = min((t.start_effective_date for t in renew_existing), default=payload.start_date or today)
        end_date = RENEW_END
        to_deactivate = active
        old_cells = _open_cells(active)
        conflict_from, conflict_to = today, None
    else:
        # Period.
        start_date, end_date = payload.start_date, payload.end_date
        if start_date > end_date:
            raise HTTPException(status_code=400, detail="תאריך התחלה מאוחר מתאריך הסיום")

        if switching:
            # renew -> period: wipe the renew schedule, create this first period.
            to_deactivate = active
            old_cells = _open_cells(active)
            conflict_from, conflict_to = today, None
            other_periods: list[tuple[date, date]] = []
        else:
            # already in period model
            period_groups = {
                (t.start_effective_date, t.end_effective_date)
                for t in active if not _is_renew_end(t.end_effective_date)
            }
            if payload.orig_start and payload.orig_end:
                # editing an existing period
                if payload.orig_end < today:
                    raise HTTPException(status_code=400, detail="לא ניתן לערוך תקופה שהסתיימה")
                edited = [
                    t for t in active
                    if t.start_effective_date == payload.orig_start and t.end_effective_date == payload.orig_end
                ]
                if not edited:
                    raise HTTPException(status_code=404, detail="התקופה לעריכה לא נמצאה")
                to_deactivate = edited
                old_cells = _open_cells(edited)
                conflict_from = max(today, payload.orig_start)
                conflict_to = payload.orig_end
                other_periods = [p for p in period_groups if p != (payload.orig_start, payload.orig_end)]
            else:
                # brand-new period
                to_deactivate = []
                old_cells = set()
                conflict_from, conflict_to = today, None
                other_periods = list(period_groups)

        # No overlapping date ranges with other periods on this court.
        for ps, pe in other_periods:
            if not (end_date < ps or start_date > pe):
                raise HTTPException(
                    status_code=400,
                    detail=f"התקופה חופפת לתקופה קיימת ({ps:%d/%m/%Y}–{pe:%d/%m/%Y})",
                )

    # ---- Block-conflict check: cells that were open and are now removed. ----
    new_cells = {(c.day, c.hour) for c in payload.cells}
    blocked = old_cells - new_cells
    conflicts = _future_booking_conflicts(db, manager.club_id, payload.court_number, blocked, conflict_from, conflict_to)
    if conflicts and not payload.confirm_block_conflicts:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "קיימות הזמנות עתידיות במשבצות שברצונך לחסום.",
                "conflicts": conflicts,
            },
        )

    # ---- Apply: deactivate old set(s), create the new set. ----
    proto = (to_deactivate or active or [None])[0]
    for_member = proto.for_member if proto else None
    surface_type = proto.surface_type if proto else None
    for t in to_deactivate:
        t.is_active = "N"

    merged = _merge_cells(payload.cells)
    for days_str, fh, eh, m, nm, off in merged:
        db.add(RentalTemplate(
            club_id=manager.club_id,
            court_number=payload.court_number,
            start_effective_date=start_date,
            end_effective_date=end_date,
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
    model_label = "קבוע" if target_model == "auto" else "משתנה לפי תקופה"
    when = "ללא תאריך סיום" if target_model == "auto" else f"{start_date:%d/%m/%Y}–{end_date:%d/%m/%Y}"
    if switching:
        audit.record(
            db, manager.user, "schedule.model_change",
            f"שינוי מודל לוח זמנים — מגרש {payload.court_number} → {model_label}",
            club_id=manager.club_id, club_name=club_name,
            detail={"court_number": payload.court_number, "from": current_model, "to": target_model},
        )
    audit.record(
        db, manager.user, "schedule.save",
        f"עודכן לוח זמנים ({model_label}) — מגרש {payload.court_number}, {when}, {created} תבניות",
        club_id=manager.club_id, club_name=club_name,
        detail={
            "court_number": payload.court_number,
            "model": target_model,
            "start_date": str(start_date),
            "end_date": str(end_date),
            "blocked_with_bookings": len(conflicts),
            "templates": [
                {"days": ds, "from_hour": fh, "end_hour": eh,
                 "member_price": m, "non_member_price": nm, "minutes_offset": off}
                for ds, fh, eh, m, nm, off in merged
            ],
        },
    )

    db.commit()
    return {
        "message": "לוח הזמנים נשמר.",
        "templates_created": created,
        "model": target_model,
    }


class PeriodRef(BaseModel):
    court_number: int
    start_date: date
    end_date: date
    confirm_block_conflicts: bool = False


@router.delete("/period")
def delete_period(body: PeriodRef, db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    """Deactivate one period's templates. Warns (409) if it would remove slots
    that have future confirmed bookings, unless confirm_block_conflicts=True."""
    today = date.today()
    templates = [
        t for t in _active_templates(db, manager.club_id, body.court_number)
        if t.start_effective_date == body.start_date and t.end_effective_date == body.end_date
    ]
    if not templates:
        raise HTTPException(status_code=404, detail="התקופה לא נמצאה")

    old_cells = _open_cells(templates)
    conflicts = _future_booking_conflicts(
        db, manager.club_id, body.court_number, old_cells, max(today, body.start_date), body.end_date
    )
    if conflicts and not body.confirm_block_conflicts:
        raise HTTPException(
            status_code=409,
            detail={"message": "קיימות הזמנות עתידיות בתקופה זו.", "conflicts": conflicts},
        )

    for t in templates:
        t.is_active = "N"

    club_name = manager.club.club_name if manager.club else None
    audit.record(
        db, manager.user, "period.delete",
        f"נמחקה תקופה — מגרש {body.court_number}, {body.start_date:%d/%m/%Y}–{body.end_date:%d/%m/%Y}",
        club_id=manager.club_id, club_name=club_name,
        detail={"court_number": body.court_number,
                "start_date": str(body.start_date), "end_date": str(body.end_date)},
    )
    db.commit()
    return {"message": "התקופה נמחקה. לחצו \"חשוף שינויים למשתמשים\" כדי להחיל."}


class PurgeOldRef(BaseModel):
    court_number: int


@router.post("/periods/purge-old")
def purge_old_periods(body: PurgeOldRef, db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    """Deactivate all periods on a court whose end date is more than 30 days
    past (no longer effective). Renew schedules are never affected. No booking
    conflict check needed — these dates are well in the past."""
    threshold = date.today() - timedelta(days=30)
    to_deactivate = [
        t for t in _active_templates(db, manager.club_id, body.court_number)
        if not _is_renew_end(t.end_effective_date)
        and t.end_effective_date is not None
        and t.end_effective_date < threshold
    ]
    period_keys = {(t.start_effective_date, t.end_effective_date) for t in to_deactivate}
    for t in to_deactivate:
        t.is_active = "N"

    club_name = manager.club.club_name if manager.club else None
    audit.record(
        db, manager.user, "period.purge_old",
        f"נמחקו {len(period_keys)} תקופות ישנות — מגרש {body.court_number}",
        club_id=manager.club_id, club_name=club_name,
        detail={"court_number": body.court_number,
                "periods": [f"{s}..{e}" for (s, e) in sorted(period_keys)]},
    )
    db.commit()
    return {
        "message": f"נמחקו {len(period_keys)} תקופות ישנות. לחצו \"חשוף שינויים למשתמשים\" כדי להחיל.",
        "deleted": len(period_keys),
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

    # Housekeeping: drop deactivated templates that no longer have any slot
    # referencing them. Templates still referenced by a booked slot are kept.
    referenced = db.query(AvailableCourtSlot.rental_template_id).distinct()
    db.query(RentalTemplate).filter(
        RentalTemplate.club_id == manager.club_id,
        RentalTemplate.is_active == "N",
        RentalTemplate.id.notin_(referenced),
    ).delete(synchronize_session=False)

    free_slots = (
        db.query(func.count(AvailableCourtSlot.id))
        .join(RentalTemplate, AvailableCourtSlot.rental_template_id == RentalTemplate.id)
        .filter(RentalTemplate.club_id == manager.club_id, AvailableCourtSlot.order_id.is_(None))
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
