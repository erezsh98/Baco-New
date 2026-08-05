"""
Holiday-dates management for club managers (holiday_dates table).

Two kinds of block, both stored in the legacy holiday_dates table (whose row
means "start_hour..end_hour on every day in [start_date..end_date]"), so the
rebuild() job is unchanged:

  • PERIOD  — a CONTINUOUS block from (start_date, start_hour) to
    (end_date, end_hour). Stored DECOMPOSED into grid rows:
        27/7 10:00 -> 28/7 19:00  ==>  (27/7,27/7,10..23) + (28/7,28/7,0..19)
        27/7 10:00 -> 30/7 19:00  ==>  (27/7,27/7,10..23)+(28/7,29/7,0..23)+(30/7,30/7,0..19)
  • RECURRING — the same hours EVERY day across a date range (the native legacy
    grid meaning). Stored as ONE row: (start_date, end_date, start_hour, end_hour).

Read-back tells them apart with no ambiguity: a period decomposition never
produces a multi-day row with partial hours, so a **multi-day partial row is
always a recurring block**; everything else is a period (contiguous rows merged).
Hours are inclusive (matches the rebuild's holiday marking). Scoped to the
manager's own club; DB structure unchanged.
"""
from datetime import date, timedelta

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.dependencies import require_club_manager
from app.database import get_db
from app.models.club import ClubManager
from app.models.court import HolidayDate
from app.services.scheduler import rebuild

router = APIRouter(prefix="/admin/holidays", tags=["holidays"])

MAX_HOUR = 23
PERIOD = "period"
RECURRING = "recurring"


class SpanIn(BaseModel):
    block_type: str = PERIOD          # "period" | "recurring"
    start_date: date
    start_hour: int
    end_date: date
    end_hour: int


class SpanReplace(SpanIn):
    ids: list[int]


class SpanOut(BaseModel):
    ids: list[int]          # the holiday_dates row ids this block is stored as
    block_type: str
    start_date: date
    start_hour: int
    end_date: date
    end_hour: int


def _validate(s: SpanIn) -> None:
    if not (0 <= s.start_hour <= 23) or not (0 <= s.end_hour <= 23):
        raise HTTPException(status_code=400, detail="שעה חייבת להיות בין 0 ל-23")
    if s.block_type == RECURRING:
        if s.start_date > s.end_date:
            raise HTTPException(status_code=400, detail="תאריך התחלה מאוחר מתאריך הסיום")
        if s.start_hour > s.end_hour:
            raise HTTPException(status_code=400, detail="שעת התחלה מאוחרת משעת הסיום")
    else:  # period — a continuous datetime range
        if (s.start_date, s.start_hour) > (s.end_date, s.end_hour):
            raise HTTPException(status_code=400, detail="מועד ההתחלה מאוחר ממועד הסיום")


def _decompose(sd: date, sh: int, ed: date, eh: int) -> list[tuple[date, date, int, int]]:
    """A continuous PERIOD span -> grid rows whose union is exactly that block."""
    if sd == ed:
        return [(sd, ed, sh, eh)]
    rows: list[tuple[date, date, int, int]] = [(sd, sd, sh, MAX_HOUR)]  # first day: sh..EOD
    if ed - sd >= timedelta(days=2):                                     # full middle days
        rows.append((sd + timedelta(days=1), ed - timedelta(days=1), 0, MAX_HOUR))
    rows.append((ed, ed, 0, eh))                                         # last day: SOD..eh
    return rows


def _is_recurring_row(r: HolidayDate) -> bool:
    """A multi-day row with partial hours can only be a recurring block —
    period decomposition never yields one."""
    return r.start_date != r.end_date and not (r.start_hour == 0 and r.end_hour == MAX_HOUR)


def _abs_hour(d: date, h: int) -> int:
    return d.toordinal() * 24 + h


def _recompose(rows: list[HolidayDate]) -> list[dict]:
    """Return one logical block per group. Recurring rows stand alone; the rest
    (period fragments) are merged by contiguity into continuous spans."""
    recurring = [r for r in rows if _is_recurring_row(r)]
    period_rows = [r for r in rows if not _is_recurring_row(r)]

    items = sorted(
        ({"abs_start": _abs_hour(r.start_date, r.start_hour),
          "abs_end": _abs_hour(r.end_date, r.end_hour), "row": r} for r in period_rows),
        key=lambda x: (x["abs_start"], x["abs_end"]),
    )
    spans: list[dict] = []
    for it in items:
        r = it["row"]
        if spans and it["abs_start"] <= spans[-1]["_abs_end"] + 1:
            g = spans[-1]
            g["ids"].append(r.id)
            if it["abs_end"] > g["_abs_end"]:
                g["_abs_end"] = it["abs_end"]
                g["end_date"] = r.end_date
                g["end_hour"] = r.end_hour
        else:
            spans.append({
                "ids": [r.id], "block_type": PERIOD,
                "start_date": r.start_date, "start_hour": r.start_hour,
                "end_date": r.end_date, "end_hour": r.end_hour,
                "_abs_end": it["abs_end"],
            })
    for s in spans:
        s.pop("_abs_end")

    for r in recurring:
        spans.append({
            "ids": [r.id], "block_type": RECURRING,
            "start_date": r.start_date, "start_hour": r.start_hour,
            "end_date": r.end_date, "end_hour": r.end_hour,
        })
    return spans


def _delete_rows(db: Session, ids: list[int], club_id: int) -> None:
    if ids:
        db.query(HolidayDate).filter(
            HolidayDate.id.in_(ids), HolidayDate.club_id == club_id
        ).delete(synchronize_session=False)


def _create_block(db: Session, club_id: int, s: SpanIn) -> None:
    if s.block_type == RECURRING:
        # one grid row: the same hours every day in the range (legacy meaning)
        db.add(HolidayDate(club_id=club_id, start_date=s.start_date, end_date=s.end_date,
                           start_hour=s.start_hour, end_hour=s.end_hour))
    else:
        for sd, ed, sh, eh in _decompose(s.start_date, s.start_hour, s.end_date, s.end_hour):
            db.add(HolidayDate(club_id=club_id, start_date=sd, end_date=ed, start_hour=sh, end_hour=eh))


@router.get("", response_model=list[SpanOut])
def list_holidays(db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    rows = db.query(HolidayDate).filter(HolidayDate.club_id == manager.club_id).all()
    blocks = _recompose(rows)
    blocks.sort(key=lambda s: (s["start_date"], s["start_hour"]), reverse=True)  # newest first
    return blocks


@router.post("", status_code=201)
def create_holiday(body: SpanIn, db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    _validate(body)
    _create_block(db, manager.club_id, body)
    db.commit()
    rebuild(db)
    return {"message": "החסימה נוספה והזמינות עודכנה"}


@router.put("")
def replace_holiday(body: SpanReplace, db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    """Edit a block: drop its old rows and recreate from the new definition."""
    _validate(body)
    _delete_rows(db, body.ids, manager.club_id)
    _create_block(db, manager.club_id, body)
    db.commit()
    rebuild(db)
    return {"message": "החסימה עודכנה והזמינות עודכנה"}


@router.delete("")
def delete_holiday(ids: list[int] = Body(..., embed=True), db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    _delete_rows(db, ids, manager.club_id)
    db.commit()
    rebuild(db)
    return {"message": "החסימה נמחקה והזמינות עודכנה"}
