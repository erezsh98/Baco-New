# Promotions / מודעות עסקים מקומיים

Banners shown on the booking **thank-you page**, per club.

## How to add a promotion (v1 — no admin UI yet)

1. Find the **club id** (folder name below).
2. Put the JPEG into `public/promotions/<club_id>/`.
3. That's it — it shows up automatically after a booking for that club.

## Rules

- **Format:** `.jpg` / `.jpeg` / `.png` / `.webp`.
- **Recommended size:** square **1080×1080** (matches the layout; other ratios still work but square looks best).
- **Max 8 per club** — extras (beyond the first 8) are ignored.
- **Order:** files are shown sorted by filename. Prefix with numbers to control order, e.g. `01-cafe.jpg`, `02-sport-store.jpg`, `03-...`.
- **Contract periods / clickable links / analytics:** not in v1 — those come with the admin-UI phase. For now, add/remove files by hand to start/stop a promotion.

## Club id → club name

| folder | club |
|--------|------|
| `1/`   | תל מונד |

_(Add a folder per club id as clubs are added.)_
