"""
One-off cleanup for duplicate FREE slots created by the pre-fix rebuild bug.

The old rebuild could create a fresh FREE slot (order_id IS NULL) for a
physical court/date/hour that ALREADY had a BOOKED slot (order_id set) hanging
off a now-inactive template — effectively reopening a booked slot.

This script finds every FREE slot whose (club, court, date, hour) matches a
BOOKED slot and deletes ONLY those free rows, by id. Booked rows are never
touched. Run once after deploying the rebuild fix.

Usage:
    python cleanup_reopened_duplicates.py            # dry run: report only
    python cleanup_reopened_duplicates.py --apply     # actually delete
"""
import sys

sys.path.insert(0, ".")
from collections import defaultdict
from app.database import SessionLocal
from app.models.court import AvailableCourtSlot, RentalTemplate

APPLY = "--apply" in sys.argv


def main() -> int:
    db = SessionLocal()
    try:
        # Every physical slot, tagged with club/court (from its template) and
        # whether it is booked. One query, then reconcile in Python.
        rows = (
            db.query(
                AvailableCourtSlot.id,
                AvailableCourtSlot.order_id,
                AvailableCourtSlot.curdate,
                AvailableCourtSlot.hour,
                RentalTemplate.club_id,
                RentalTemplate.court_number,
            )
            .join(RentalTemplate, AvailableCourtSlot.rental_template_id == RentalTemplate.id)
            .all()
        )

        booked_keys = set()          # (club, court, date, hour) that are booked
        free_by_key = defaultdict(list)   # key -> [free slot ids]
        for sid, order_id, curdate, hour, club_id, court in rows:
            key = (club_id, court, curdate, hour)
            if order_id is not None:
                booked_keys.add(key)
            else:
                free_by_key[key].append(sid)

        # Free rows that collide with a booked row on the same physical slot.
        dupes = []          # (key, free_id)
        for key, ids in free_by_key.items():
            if key in booked_keys:
                for sid in ids:
                    dupes.append((key, sid))

        if not dupes:
            print("No reopened-duplicate free slots found. Nothing to clean.")
            return 0

        # Report grouped by club/court, sorted for readability.
        by_club = defaultdict(list)
        for (club_id, court, curdate, hour), sid in dupes:
            by_club[club_id].append((court, curdate, hour, sid))
        print(f"Found {len(dupes)} duplicate FREE slot(s) that reopened a booked hour:\n")
        for club_id in sorted(by_club):
            items = sorted(by_club[club_id], key=lambda x: (x[0], str(x[1]), x[2]))
            print(f"  club {club_id}: {len(items)} slot(s)")
            for court, curdate, hour, sid in items[:50]:
                print(f"    court {court}  {curdate} {hour:02d}:xx  -> free slot id {sid}")
            if len(items) > 50:
                print(f"    ... and {len(items) - 50} more")
        print()

        if not APPLY:
            print("DRY RUN — nothing deleted. Re-run with --apply to delete the rows above.")
            return 0

        ids = [sid for _, sid in dupes]
        deleted = (
            db.query(AvailableCourtSlot)
            .filter(AvailableCourtSlot.id.in_(ids))
            .delete(synchronize_session=False)
        )
        db.commit()
        print(f"DELETED {deleted} duplicate free slot(s). Booked slots left intact.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
