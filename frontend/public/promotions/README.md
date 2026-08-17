# Promotions / מודעות בעמוד סיום ההזמנה

Banners shown on the booking **thank-you page**, per club, in **two sections**:

- **עסקים מומלצים בקרבת המועדון** — local businesses near the court.
- **מאמני ושחקני טניס** — tennis coaches & players advertising themselves.

## How to add a promotion (v1 — no admin UI yet)

1. Find the **club id** (folder name in the table below).
2. Drop the image into the matching subfolder:
   - Business → `public/promotions/<club_id>/business/`
   - Coach / player → `public/promotions/<club_id>/coaches/`
3. That's it — it shows up automatically after a booking for that club.

> Images placed loosely in `public/promotions/<club_id>/` (no subfolder) are still
> treated as **business** promotions, for backward compatibility.

## Rules

- **Format:** `.jpg` / `.jpeg` / `.png` / `.webp`.
- **Recommended size:** square **1080×1080** (matches the layout; other ratios still work).
- **Max 8 per section** (8 business + 8 coaches) — extras beyond the first 8 are ignored.
- **Order:** shown sorted by filename. Prefix with numbers to control order, e.g. `01-cafe.jpg`, `02-sport-store.jpg`.
- A section is hidden entirely when its folder has no images.
- **Contract periods / clickable links / analytics:** not in v1 — those come with the admin-UI phase. For now, add/remove files by hand.

## Club id → club name

| folder | club |
|--------|------|
| `1/`   | תל מונד |
| `2/`   | קדימה |

_(Add a folder per club id, each with `business/` and `coaches/` subfolders, as clubs are added.)_
