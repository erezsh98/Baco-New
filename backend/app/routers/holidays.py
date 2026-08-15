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
from app.models.court import AvailableCourtSlot, HolidayDate, RentalTemplate
from app.models.order import CourtOrder
from app.services import audit
from app.services.scheduler import rebuild

router = APIRouter(prefix="/admin/holidays", tags=["holidays"])


def _court_label(court_number) -> str:
    return "כל המגרשים" if court_number is None else f"מגרש {court_number}"

MAX_HOUR = 23
PERIOD = "period"
RECURRING = "recurring"


class SpanIn(BaseModel):
    block_type: str = PERIOD          # "period" | "recurring"
    court_number: int | None = None   # None = all courts in the club
    start_date: date
    start_hour: int
    end_date: date
    end_hour: int
    confirm_block_conflicts: bool = False   # proceed even if existing bookings fall in the block


class SpanReplace(SpanIn):
    ids: list[int]


class SpanOut(BaseModel):
    ids: list[int]          # the holiday_dates row ids this block is stored as
    block_type: str
    court_number: int | None = None
    start_date: date
    start_hour: int
    end_date: date
    end_hour: int


def _validate(s: SpanIn) -> None:
    # end_hour is the EXCLUSIVE "to" clock hour: 22 = "up to 22:00" (last session 21:00-22:00).
    # It may be 24 (= up to midnight). start_hour is an inclusive session start (0-23).
    if not (0 <= s.start_hour <= 23) or not (1 <= s.end_hour <= 24):
        raise HTTPException(status_code=400, detail="שעה חייבת להיות בטווח תקין")
    if s.block_type == RECURRING:
        if s.start_date > s.end_date:
            raise HTTPException(status_code=400, detail="תאריך התחלה מאוחר מתאריך הסיום")
        if s.start_hour >= s.end_hour:
            raise HTTPException(status_code=400, detail="שעת הסיום חייבת להיות אחרי שעת ההתחלה")
    else:  # period — a continuous datetime range; end must be strictly after start
        if (s.start_date, s.start_hour) >= (s.end_date, s.end_hour):
            raise HTTPException(status_code=400, detail="מועד הסיום חייב להיות אחרי מועד ההתחלה")


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
    (period fragments) are merged by contiguity into continuous spans. Blocks are
    grouped per court (court_number None = all courts) so fragments of different
    courts are never merged together."""
    by_court: dict = {}
    for r in rows:
        by_court.setdefault(r.court_number, []).append(r)

    result: list[dict] = []
    for court_number, crows in by_court.items():
        recurring = [r for r in crows if _is_recurring_row(r)]
        period_rows = [r for r in crows if not _is_recurring_row(r)]

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
                    "ids": [r.id], "block_type": PERIOD, "court_number": court_number,
                    "start_date": r.start_date, "start_hour": r.start_hour,
                    "end_date": r.end_date, "end_hour": r.end_hour,
                    "_abs_end": it["abs_end"],
                })
        for s in spans:
            s.pop("_abs_end")

        for r in recurring:
            spans.append({
                "ids": [r.id], "block_type": RECURRING, "court_number": court_number,
                "start_date": r.start_date, "start_hour": r.start_hour,
                "end_date": r.end_date, "end_hour": r.end_hour,
            })
        result.extend(spans)
    return result


def _delete_rows(db: Session, ids: list[int], club_id: int) -> None:
    if ids:
        db.query(HolidayDate).filter(
            HolidayDate.id.in_(ids), HolidayDate.club_id == club_id
        ).delete(synchronize_session=False)


def _create_block(db: Session, club_id: int, s: SpanIn) -> None:
    if s.block_type == RECURRING:
        # one grid row: the same hours every day in the range (legacy meaning)
        db.add(HolidayDate(club_id=club_id, court_number=s.court_number,
                           start_date=s.start_date, end_date=s.end_date,
                           start_hour=s.start_hour, end_hour=s.end_hour))
    else:
        for sd, ed, sh, eh in _decompose(s.start_date, s.start_hour, s.end_date, s.end_hour):
            db.add(HolidayDate(club_id=club_id, court_number=s.court_number,
                               start_date=sd, end_date=ed, start_hour=sh, end_hour=eh))


def _block_conflicts(db: Session, club_id: int, s: SpanIn) -> list[dict]:
    """
    Confirmed FUTURE reservations that fall inside the block about to be created
    (uses the STORED, already-decremented hours). Blocking never cancels these —
    it only stops offering the slots — so the admin is asked before proceeding.
    """
    rows = (
        [(s.start_date, s.end_date, s.start_hour, s.end_hour)]
        if s.block_type == RECURRING
        else _decompose(s.start_date, s.start_hour, s.end_date, s.end_hour)
    )
    today = date.today()
    seen: set[int] = set()
    out: list[dict] = []
    for sd, ed, sh, eh in rows:
        q = (
            db.query(AvailableCourtSlot, CourtOrder)
            .join(RentalTemplate, AvailableCourtSlot.rental_template_id == RentalTemplate.id)
            .join(CourtOrder, AvailableCourtSlot.order_id == CourtOrder.id)
            .filter(
                RentalTemplate.club_id == club_id,
                AvailableCourtSlot.order_id.isnot(None),
                CourtOrder.is_final == "Y",
                AvailableCourtSlot.curdate >= sd,
                AvailableCourtSlot.curdate <= ed,
                AvailableCourtSlot.curdate >= today,
                AvailableCourtSlot.hour >= sh,
                AvailableCourtSlot.hour <= eh,
            )
        )
        if s.court_number is not None:      # NULL block = all courts
            q = q.filter(RentalTemplate.court_number == s.court_number)
        for slot, order in q.all():
            if slot.id in seen:
                continue
            seen.add(slot.id)
            u = order.user
            out.append({
                "date": str(slot.curdate),
                "hour": slot.hour,
                "court_number": slot.rental_template.court_number,
                "order_id": order.order_id,
                "customer": f"{u.first_name} {u.last_name}" if u else "",
            })
    out.sort(key=lambda x: (x["date"], x["hour"]))
    return out


@router.get("", response_model=list[SpanOut])
def list_holidays(db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    rows = db.query(HolidayDate).filter(HolidayDate.club_id == manager.club_id).all()
    blocks = _recompose(rows)
    for b in blocks:
        b["end_hour"] += 1  # stored value is the last blocked slot; show the exclusive to-hour
    blocks.sort(key=lambda s: (s["start_date"], s["start_hour"]), reverse=True)  # newest first
    return blocks


@router.post("", status_code=201)
def create_holiday(body: SpanIn, db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    _validate(body)
    to_hour = body.end_hour  # user-facing exclusive to-hour, before we decrement
    body.end_hour -= 1  # store the last blocked slot hour (the to-hour is exclusive)

    conflicts = _block_conflicts(db, manager.club_id, body)
    if conflicts and not body.confirm_block_conflicts:
        raise HTTPException(status_code=409, detail={
            "message": "קיימות הזמנות עתידיות במשבצות שברצונך לחסום.",
            "conflicts": conflicts,
        })

    _create_block(db, manager.club_id, body)
    audit.record(
        db, manager.user, "holiday.create",
        f"נוספה חסימה — {_court_label(body.court_number)}, "
        f"{body.start_date:%d/%m/%Y} {body.start_hour}:00–{to_hour}:00",
        club_id=manager.club_id, club_name=(manager.club.club_name if manager.club else None),
        detail={"court_number": body.court_number, "start_date": str(body.start_date),
                "end_date": str(body.end_date), "start_hour": body.start_hour, "to_hour": to_hour},
    )
    db.commit()
    rebuild(db)
    return {"message": "החסימה נוספה והזמינות עודכנה"}


@router.put("")
def replace_holiday(body: SpanReplace, db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    """Edit a block: drop its old rows and recreate from the new definition."""
    _validate(body)
    to_hour = body.end_hour  # user-facing exclusive to-hour, before we decrement
    body.end_hour -= 1  # store the last blocked slot hour (the to-hour is exclusive)

    conflicts = _block_conflicts(db, manager.club_id, body)
    if conflicts and not body.confirm_block_conflicts:
        raise HTTPException(status_code=409, detail={
            "message": "קיימות הזמנות עתידיות במשבצות שברצונך לחסום.",
            "conflicts": conflicts,
        })

    _delete_rows(db, body.ids, manager.club_id)
    _create_block(db, manager.club_id, body)
    audit.record(
        db, manager.user, "holiday.update",
        f"עודכנה חסימה — {_court_label(body.court_number)}, "
        f"{body.start_date:%d/%m/%Y} {body.start_hour}:00–{to_hour}:00",
        club_id=manager.club_id, club_name=(manager.club.club_name if manager.club else None),
        detail={"ids": body.ids, "court_number": body.court_number, "start_date": str(body.start_date),
                "end_date": str(body.end_date), "start_hour": body.start_hour, "to_hour": to_hour},
    )
    db.commit()
    rebuild(db)
    return {"message": "החסימה עודכנה והזמינות עודכנה"}


@router.delete("")
def delete_holiday(ids: list[int] = Body(..., embed=True), db: Session = Depends(get_db), manager: ClubManager = Depends(require_club_manager)):
    _delete_rows(db, ids, manager.club_id)
    audit.record(
        db, manager.user, "holiday.delete",
        f"בוטלו {len(ids)} חסימות",
        club_id=manager.club_id, club_name=(manager.club.club_name if manager.club else None),
        detail={"ids": ids},
    )
    db.commit()
    rebuild(db)
    return {"message": "החסימה נמחקה והזמינות עודכנה"}
