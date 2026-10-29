# Changelog

All notable changes to BACO / TennisLine are recorded here.
Versioning follows **SemVer** (`MAJOR.MINOR.PATCH`): new backward-compatible
features bump MINOR, bug fixes bump PATCH, breaking changes bump MAJOR.

## [Unreleased]
### Added
- **TTLock integration** — in progress on branch `feature/ttlock-integration`
  (targets release **v1.1.0**).

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
