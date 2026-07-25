from datetime import date, datetime, timedelta, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.court import AvailableCourtSlot, RentalTemplate, HolidayDate, HolidayOverwrite
from app.models.order import CourtOrder, UsersCart

NUM_DAYS_AHEAD = 30


def rebuild(db: Session | None = None) -> None:
    """Regenerate available court slots for the next 30 days."""
    close = db is None
    if db is None:
        db = SessionLocal()
    try:
        # Clean slate: drop every slot not tied to an order (free slots AND
        # abandoned-cart slots), keeping only slots with a real order. Matches
        # the legacy rebuild's "delete ... where taken is null" so that edits
        # which remove availability (blocked cells) don't leave stale slots.
        db.query(AvailableCourtSlot).filter(AvailableCourtSlot.order_id.is_(None)).delete()

        today = date.today()
        templates = db.query(RentalTemplate).filter(RentalTemplate.is_active == "Y").all()

        for tmpl in templates:
            club = tmpl.club
            days = [int(d) for d in tmpl.days_str.split(",") if d.strip()]

            for offset in range(NUM_DAYS_AHEAD):
                target_date = today + timedelta(days=offset)
                # day_of_week: 1=Sunday ... 7=Saturday (matching original app)
                dow = target_date.isoweekday() % 7 + 1  # isoweekday Mon=1..Sun=7 → Sun=1..Sat=7

                if dow not in days:
                    continue
                if offset < (club.rent_threshold_days or 0):
                    continue

                for hour in range(tmpl.from_hour, tmpl.end_hour + 1):  # end_hour inclusive (matches legacy)
                    if offset == 0 and hour < (club.rental_threshold_hours or 0):
                        continue
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
        holidays = db.query(HolidayDate).all()
        for h in holidays:
            club_tmpl_ids = db.query(RentalTemplate.id).filter(RentalTemplate.club_id == h.club_id)
            db.query(AvailableCourtSlot).filter(
                AvailableCourtSlot.rental_template_id.in_(club_tmpl_ids),
                AvailableCourtSlot.curdate >= h.start_date,
                AvailableCourtSlot.curdate <= h.end_date,
                AvailableCourtSlot.hour >= h.start_hour,
                AvailableCourtSlot.hour <= h.end_hour,   # inclusive (matches legacy)
                AvailableCourtSlot.taken.is_(None),
            ).update({"is_holiday": "Y"}, synchronize_session=False)

        # Remove holiday markers for overrides
        overwrites = db.query(HolidayOverwrite).all()
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
