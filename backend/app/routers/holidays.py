"""
Holiday-dates management for club managers (holiday_dates table).

A holiday is now a CONTINUOUS span from (start_date, start_hour) to
(end_date, end_hour). The holiday_dates table keeps its original "grid" meaning
(each row = start_hour..end_hour on every day in [start_date..end_date]), so the
rebuild() job is unchanged. To represent a continuous span we DECOMPOSE it into
grid rows on save:

    span 27/7 10:00 -> 28/7 19:00  ==>  (27/7, 27/7, 10..23) + (28/7, 28/7, 0..19)
    span 27/7 10:00 -> 30/7 19:00  ==>  (27/7,27/7,10..23) + (28/7,29/7,0..23) + (30/7,30/7,0..19)

and RECOMPOSE contiguous rows back into one logical span for the view.
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


class SpanIn(BaseModel):
    start_date: date
    start_hour: int
    end_date: date
    end_hour: int


class SpanReplace(SpanIn):
    ids: list[int]


class SpanOut(BaseModel):
    ids: list[int]          # the holiday_dates row ids this span is stored as
    start_date: date
    start_hour: int
    end_date: date
    end_hour: int


def _validate(s: SpanIn) -> None:
    if not (0 <= s.start_hour <= 23) or not (0 <= s.end_hour <= 23):
        raise HTTPException(status_code=400, detail="שעה חייבת להיות בין 0 ל-23")
    if (s.start_date, s.start_hour) > (s.end_date, s.end_hour):
        raise HTTPException(status_code=400, detail="מועד ההתחלה מאוחר ממועד הסיום")


def _decompose(sd: date, sh: int, ed: date, eh: int) -> list[tuple[date, date, int, int]]:
    """A continuous span -> grid rows whose union is exactly that block."""
    if sd == ed:
        return [(sd, ed, sh, eh)]
    rows: list[tuple[date, date, int, int]] = [(sd, sd, sh, MAX_HOUR)]  # first day: sh..EOD
    if ed - sd >= timedelta(days=2):                                     # full middle days
        rows.append((sd + timedelta(days=1), ed - timedelta(days=1), 0, MAX_HOUR))
    rows.append((ed, ed, 0, eh))                                         # last day: SOD..eh
    return rows


def _abs_hour(d: date, h: int) -> int:
    return d.toordinal() * 24 + h


def _recompose(rows: list[HolidayDate]) -> list[dict]:
    """Merge contiguous grid rows into logical continuous spans. Each row is an
    interval [(start_date,start_hour) .. (end_date,end_hour)]; rows that touch
    (next start <= current end + 1 hour) belong to the same span."""
    items = sorted(
        (
            {
                "abs_start": _abs_hour(r.start_date, r.start_hour),
                "abs_end": _abs_hour(r.end_date, r.end_hour),
                "row": r,
            }
            for r in rows
        ),
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
                "ids": [r.id],
                "start_date": r.start_date,
                "start_hour": r.start_hour,
                "end_date": r.end_date,
                "end_hour": r.end_hour,
                "_abs_end": it["abs_end"],
            })
    for s in spans:
        s.pop("_abs_end")
    return spans


def _delete_rows(db: Session, ids: list[int], club_id: int) -> None:
    if ids:
        db.query(HolidayDate).filter(
            HolidayDate.id.in_(ids), HolidayDate.club_id == club_id
        ).delete(synchronize_session=False)


def _create_span(db: Session, club_id: int, s: SpanIn) -> None:
    for sd, ed, sh, eh in _decompose(s.start_date, s.start_hour, s.end_date, s.end_hour):
        db.add(HolidayDate(club_id=club_id, start_date=sd, end_date=ed, start_hour=sh, end_hour=eh))


@router.get("", response_model=list[SpanOut])
def list_holidays(db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    rows = db.query(HolidayDate).filter(HolidayDate.club_id == manager.club_id).all()
    spans = _recompose(rows)
    spans.sort(key=lambda s: (s["start_date"], s["start_hour"]), reverse=True)  # newest first
    return spans


@router.post("", status_code=201)
def create_holiday(body: SpanIn, db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    _validate(body)
    _create_span(db, manager.club_id, body)
    db.commit()
    rebuild(db)
    return {"message": "יום החג נוסף והזמינות עודכנה"}


@router.put("")
def replace_holiday(body: SpanReplace, db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    """Edit a logical span: drop its old rows and recreate from the new span."""
    _validate(body)
    _delete_rows(db, body.ids, manager.club_id)
    _create_span(db, manager.club_id, body)
    db.commit()
    rebuild(db)
    return {"message": "יום החג עודכן והזמינות עודכנה"}


@router.delete("")
def delete_holiday(ids: list[int] = Body(..., embed=True), db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    _delete_rows(db, ids, manager.club_id)
    db.commit()
    rebuild(db)
    return {"message": "יום החג נמחק והזמינות עודכנה"}
