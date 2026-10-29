"""
Diagnose / verify a club's TTLock gate setup.

    python test_ttlock.py <club_id>                 # read-only: config + lock capabilities
    python test_ttlock.py <club_id> --pin           # also mint a real PIN for the NEXT full hour
    python test_ttlock.py <club_id> --pin --date 2026-11-01 --hour 18

Reads the per-club TTLOCK_<club_id>_* env vars (same as the app), logs in to the
TTLock cloud, and reports the lock's capabilities so you can confirm it has a
keypad + clock chip before relying on offline PINs. Run it on the target
environment (the VM), exactly like test_email.py for SMTP.

Secrets are never printed. Plain (read-only) runs mint nothing; --pin creates a
real, usable code on the real lock (TTLock has no sandbox).
"""
import sys
from datetime import date, datetime, timedelta

from app.services.ttlock import (
    CLUB_TZ,
    _Client,
    pin_window_ms,
    ttlock_config,
)

# featureValue bits we care about (see the POC's ttlock/features.ts).
FEATURE = {"PASSCODE": 0, "GATEWAY_UNLOCK": 10, "NO_CLOCK": 20, "QR_CODE": 44, "WIFI": 56}


def has_feature(feature_value: str | None, bit: int) -> bool:
    if not feature_value:
        return False
    try:
        return (int(feature_value, 16) & (1 << bit)) != 0
    except ValueError:
        return False


class _Club:
    def __init__(self, cid: int):
        self.id = cid


class _Slot:
    def __init__(self, d: date, hour: int, club: _Club):
        self.curdate = d
        self.hour = hour
        self.rental_template = type("T", (), {"minutes_offset": 0, "club": club})()


class _Order:
    def __init__(self, slot):
        self.slot = slot
        self.order_id = "TEST"
        self.id = 0


def main(argv: list[str]) -> int:
    if not argv or not argv[0].isdigit():
        print("usage: python test_ttlock.py <club_id> [--pin] [--date YYYY-MM-DD --hour HH]")
        return 2
    club_id = int(argv[0])
    do_pin = "--pin" in argv

    def opt(name):
        return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else None

    club = _Club(club_id)
    cfg = ttlock_config(club)
    print(f"=== TTLock config for club {club_id} ===")
    if not cfg:
        print("  (none) - no TTLOCK_%d_LOCK_ID / _USERNAME / client credentials in the environment." % club_id)
        print("  This club simply has no gate code; bookings are unaffected.")
        return 1
    print(f"  api_base       : {cfg['api_base']}")
    print(f"  client_id      : {cfg['client_id'][:6]}... (len {len(cfg['client_id'])})")
    print(f"  client_secret  : (set, len {len(cfg['client_secret'])})")
    print(f"  username       : {cfg['username']}")
    print(f"  password_md5   : (set, len {len(cfg['password_md5'])})")
    print(f"  lock_id        : {cfg['lock_id']}")
    print(f"  early_entry_min: {cfg['early_entry_min']}")
    print()

    client = _Client(cfg)
    try:
        print("[1/2] logging in to the TTLock cloud ...")
        client._login()
        print("      login OK (token acquired).")
        print("[2/2] reading lock detail ...")
        detail = client._call("lock/detail", {"lockId": cfg["lock_id"]})
        print("      lock detail OK.")
    except Exception as e:
        print("\nFAILED:", type(e).__name__, e)
        print("  -> Check the credentials, that the account owns this lock, and that the")
        print("     server clock is accurate (TTLock rejects skew > 5 min).")
        return 1

    fv = detail.get("featureValue")
    keypad = has_feature(fv, FEATURE["PASSCODE"])
    has_clock = not has_feature(fv, FEATURE["NO_CLOCK"])
    qr = has_feature(fv, FEATURE["QR_CODE"])
    gateway = bool(detail.get("hasGateway"))
    print()
    print("=== lock capabilities ===")
    print(f"  name           : {detail.get('lockName') or detail.get('lockAlias')}")
    print(f"  battery        : {detail.get('electricQuantity')}%")
    print(f"  featureValue   : {fv}")
    print(f"  keypad (PIN)   : {'YES' if keypad else 'NO'}")
    print(f"  clock chip     : {'YES' if has_clock else 'NO'}")
    print(f"  QR reader      : {'yes' if qr else 'no'}")
    print(f"  has gateway    : {'yes' if gateway else 'no'}")
    print()
    if keypad and has_clock:
        print("  VERDICT: offline keypad PIN is supported. OK")
    else:
        print("  VERDICT: offline keypad PIN is NOT viable on this lock"
              f"{' (no keypad)' if not keypad else ''}{' (no clock chip)' if not has_clock else ''}.")
        if qr:
            print("           it has a QR reader - that path needs the QR pass-page design.")

    if not do_pin:
        print("\n(Read-only run. Add --pin to mint a real test code.)")
        return 0

    # Mint a real PIN for the chosen (or next) full hour.
    d = opt("--date")
    h = opt("--hour")
    when_date = date.fromisoformat(d) if d else None
    if when_date is None or h is None:
        nxt = (datetime.now(CLUB_TZ) + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
        when_date, hour = nxt.date(), nxt.hour
    else:
        hour = int(h)
    order = _Order(_Slot(when_date, hour, club))
    win = pin_window_ms(order, cfg["early_entry_min"])
    a = datetime.fromtimestamp(win[0] / 1000, CLUB_TZ)
    b = datetime.fromtimestamp(win[1] / 1000, CLUB_TZ)
    print(f"\n[pin] minting an offline PIN for {when_date} {hour:02d}:00  (valid {a:%H:%M}-{b:%H:%M}) ...")
    try:
        pin = client.get_offline_pin(win[0], win[1], "BACO test")
        print(f"      PIN = {pin}   (type it on the keypad during the window above)")
        print("      Note: this is a real code on the real lock and is NOT auto-revoked.")
        return 0
    except Exception as e:
        print("      FAILED to mint PIN:", type(e).__name__, e)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
