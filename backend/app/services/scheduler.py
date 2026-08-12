from datetime import date, datetime, timedelta, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.court import AvailableCourtSlot, RentalTemplate, HolidayDate, HolidayOverwrite
from app.models.order import CourtOrder, UsersCart

NUM_DAYS_AHEAD = 30  # default slot-generation window when a club has no slot_window_days set


def rebuild(db: Session | None = None, club_id: int | None = None) -> None:
    """
    Regenerate available court slots for each club's booking window
    (club.slot_window_days, or 30 days when unset).

    club_id=None (the daily cron): rebuild every club — global clean slate.
    club_id set (the schedule editor's "עדכן מערכת עם השינויים" button):
    rebuild ONLY that club, leaving every other club's free slots untouched.
    """
    close = db is None
    if db is None:
        db = SessionLocal()
    try:
        # Clean slate: drop every slot not tied to an order (free slots AND
        # abandoned-cart slots), keeping only slots with a real order. Matches
        # the legacy rebuild's "delete ... where taken is null" so that edits
        # which remove availability (blocked cells) don't leave stale slots.
        # When scoped to a club, restrict the delete to that club's templates
        # (active AND inactive) so other clubs' availability is not disturbed.
        del_q = db.query(AvailableCourtSlot).filter(AvailableCourtSlot.order_id.is_(None))
        if club_id is not None:
            club_tmpl_ids = db.query(RentalTemplate.id).filter(RentalTemplate.club_id == club_id)
            del_q = del_q.filter(AvailableCourtSlot.rental_template_id.in_(club_tmpl_ids))
        del_q.delete(synchronize_session=False)

        today = date.today()
        tmpl_q = db.query(RentalTemplate).filter(RentalTemplate.is_active == "Y")
        if club_id is not None:
            tmpl_q = tmpl_q.filter(RentalTemplate.club_id == club_id)
        templates = tmpl_q.all()

        for tmpl in templates:
            club = tmpl.club
            days = [int(d) for d in tmpl.days_str.split(",") if d.strip()]
            # Per-club generation window; NULL falls back to the 30-day default.
            window_days = club.slot_window_days or NUM_DAYS_AHEAD

            for offset in range(window_days):
                target_date = today + timedelta(days=offset)
                # day_of_week: 1=Sunday ... 7=Saturday (matching original app)
                dow = target_date.isoweekday() % 7 + 1  # isoweekday Mon=1..Sun=7 → Sun=1..Sat=7

                if dow not in days:
                    continue
                if offset < (club.rent_threshold_days or 0):
                    continue

                # On the first generatable day, slots don't start before
                # admin_start_hour + rental_threshold_hours (clamped up to from_hour) —
                # legacy SchedulerService "hourToStartInCurDay". Later days: from_hour.
                start_hour = tmpl.from_hour
                if offset == 0:
                    start_hour = max(start_hour, (club.admin_start_hour or 0) + (club.rental_threshold_hours or 0))
                for hour in range(start_hour, tmpl.end_hour + 1):  # end_hour inclusive (matches legacy)
                    existing = db.query(AvailableCourtSlot).filter(
                        AvailableCourtSlot.rental_template_id == tmpl.id,
                        AvailableCourtSlot.curdate == target_date,
                        AvailableCourtSlot.hour == hour,
                    ).first()
                    if not existing:
                        db.add(AvailableCourtSlot(
                            rental_template_id=tmpl.id,
                            hour=hour,
                            curdate=target_date,
                        ))

        # Flush the freshly-added slots so the bulk holiday UPDATEs below can see
        # them. The session is autoflush=False, so without this the marking would
        # run against a DB that doesn't yet contain the new rows and match nothing.
        db.flush()

        # Apply holiday markers. Scope by the club's templates via a subquery —
        # a bulk .update() cannot run on a query that has a .join().
        hol_q = db.query(HolidayDate)
        if club_id is not None:
            hol_q = hol_q.filter(HolidayDate.club_id == club_id)
        holidays = hol_q.all()
        for h in holidays:
            club_tmpl_ids = db.query(RentalTemplate.id).filter(RentalTemplate.club_id == h.club_id)
            if h.court_number is not None:                       # block only this court
                club_tmpl_ids = club_tmpl_ids.filter(RentalTemplate.court_number == h.court_number)
            db.query(AvailableCourtSlot).filter(
                AvailableCourtSlot.rental_template_id.in_(club_tmpl_ids),
                AvailableCourtSlot.curdate >= h.start_date,
                AvailableCourtSlot.curdate <= h.end_date,
                AvailableCourtSlot.hour >= h.start_hour,
                AvailableCourtSlot.hour <= h.end_hour,   # inclusive (matches legacy)
                AvailableCourtSlot.taken.is_(None),
            ).update({"is_holiday": "Y"}, synchronize_session=False)

        # Remove holiday markers for overrides
        ow_q = db.query(HolidayOverwrite)
        if club_id is not None:
            ow_q = ow_q.filter(HolidayOverwrite.club_id == club_id)
        overwrites = ow_q.all()
        for o in overwrites:
            club_tmpl_ids = db.query(RentalTemplate.id).filter(RentalTemplate.club_id == o.club_id)
            db.query(AvailableCourtSlot).filter(
                AvailableCourtSlot.rental_template_id.in_(club_tmpl_ids),
                AvailableCourtSlot.curdate == o.date,
                AvailableCourtSlot.hour >= o.start_hour,
                AvailableCourtSlot.hour <= o.end_hour,   # inclusive (matches legacy)
            ).update({"is_holiday": None}, synchronize_session=False)

        db.commit()
    finally:
        if close:
            db.close()


def release_uncompleted_orders() -> None:
    """Release slots that have been in cart for more than 10 minutes without payment."""
    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
        stale_slots = db.query(AvailableCourtSlot).join(CourtOrder).filter(
            AvailableCourtSlot.taken < cutoff,
            CourtOrder.is_final.is_(None),
        ).all()

        for slot in stale_slots:
            slot.taken = None
            slot.order_id = None

        db.query(UsersCart).filter(
            UsersCart.available_court_slot_id.in_([s.id for s in stale_slots])
        ).delete(synchronize_session=False)

        db.commit()
    finally:
        db.close()


scheduler = BackgroundScheduler(timezone="Asia/Jerusalem")


def start_scheduler() -> None:
    scheduler.add_job(rebuild, "cron", hour=1, minute=0, id="rebuild")
    scheduler.add_job(release_uncompleted_orders, "interval", minutes=10, id="release_orders")
    scheduler.start()


def stop_scheduler() -> None:
    scheduler.shutdown()
