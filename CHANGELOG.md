# Changelog

All notable changes to BACO / TennisLine are recorded here.
Versioning follows **SemVer** (`MAJOR.MINOR.PATCH`): new backward-compatible
features bump MINOR, bug fixes bump PATCH, breaking changes bump MAJOR.

## [Unreleased]
### Added
- **TTLock integration** (branch `feature/ttlock-integration`, targets **v1.1.0**).
  Clubs with a TTLock smart gate get a per-booking **offline keypad PIN**, minted
  from the TTLock cloud at booking finalization and valid for the slot's hour
  (works offline — no gateway/internet at the court). The PIN appears in the
  confirmation email and on the user's web reservation (`/my-bookings`).
  - Per-club config is **env-only** (`TTLOCK_<CLUBID>_*`); clubs without it are
    unaffected. New service `app/services/ttlock.py`; migration **005** adds the
    nullable `court_order.gate_code` column (the only schema change).
  - No revoke on cancel (an offline PIN can't be revoked without a gateway).
    Requires NTP on the server (TTLock rejects clock skew > 5 min).

## [1.0.0] — 2026-10-03 — Production launch
First production release, live on GCP at **https://baco.co.il**. Baseline of
everything shipped to date, including:
- User booking flow (search → select court → Pelecard payment / ticket / subscription),
  mobile card layout, "remember email" login, migration banner.
- Admin & super-admin: orders report, receipts, audit log, clubs, managers,
  tickets/groups, permissions + bulk "הארכת הרשאות", holidays/blocks.
- Schedule editor: periods (תקופות) and special days (ימים מיוחדים) with override
  logic; guard against deleting a currently-active period.
- Per-club תקנון PDFs (`frontend/public/clubs/<id>/takanon.pdf`).
- In-process scheduler: nightly availability rebuild (23:00 Asia/Jerusalem) with
  per-club logging, and stale-cart cleanup every 10 min.
- Payments via Pelecard (regular one-time sales, no token/הוראת קבע), per-club
  terminal credentials by `u_name`.
- Email via Mailgun; static privacy policy + terms of use.
- Deployment: GCP VM (systemd baco-backend/baco-frontend), nginx, Let's Encrypt
  (certbot auto-renew), MySQL 8.4; docs (setup, cutover, incident-response, DB).
- Data model: `BigInteger` ids/FKs matching the production BIGINT schema;
  migrations 001–004.
