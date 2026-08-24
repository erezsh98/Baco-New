# Promotions / מודעות בעמוד סיום ההזמנה

Banners shown on the booking **thank-you page**, per club, in a single section
titled **עסקים מומלצים באזור**. Up to **6** are shown at once, in a 3×2 grid, so
they all fit on a phone screen without scrolling.

## How to add promotions (v1 — no admin UI yet)

1. Find the **club id** (folder name in the table below).
2. Drop the image(s) straight into the club's folder:
   `public/promotions/<club_id>/`
3. That's it — they show up automatically after a booking for that club.

You can put **1–20** images in the folder. On every booking **all** of them are
shown, reshuffled into a random order — so a different ad rotates into the top
slots each time. The first 6 fill the phone screen (3×2, no scroll); the rest
are seen by scrolling down. (Any leftover `business/` / `coaches/` subfolders
are still scanned too, for backward-compat — you can flatten them into
`<club_id>/`.)

## Rules

- **Format:** `.jpg` / `.jpeg` / `.png` / `.webp`.
- **Recommended size:** square **1080×1080** (the tiles are square; other ratios are cropped to square).
- **How many show:** **all** of them (up to 20), in a random order that reshuffles each booking.
- The section is hidden entirely when the club folder has no images.
- **Contract periods / clickable links / analytics:** not in v1 — add/remove files by hand for now.

## Club id → club name

| folder | club |
|--------|------|
| `1/`   | תל מונד |
| `2/`   | קדימה |

_(Add a folder per club id as clubs are added — just drop images directly in `<club_id>/`.)_
