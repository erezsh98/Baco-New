import { NextResponse } from "next/server";
import { readdir } from "fs/promises";
import path from "path";

// Promotion banners for a club, from public/promotions/<club_id>/.
// Drop 1-20 JPEG/PNG/WebP files straight into the club's folder (no sub-sections
// needed; any subfolders are still scanned for backward-compat). ALL of them are
// returned (up to 20), in RANDOM order reshuffled on every request. The first 6
// fill the phone screen (3x2, no scroll); the rest are seen by scrolling. The
// shuffle means a different ad lands in the top slots on each booking.
const MAX = 20;
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

type Promo = { src: string; name: string };

async function collect(dir: string, urlBase: string): Promise<Promo[]> {
  let out: Promo[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out; // folder doesn't exist
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) {
      out = out.concat(await collect(path.join(dir, e.name), `${urlBase}/${e.name}`));
    } else if (IMAGE_RE.test(e.name)) {
      out.push({ src: `${urlBase}/${e.name}`, name: e.name.replace(IMAGE_RE, "") });
    }
  }
  return out;
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clubId = searchParams.get("club_id") || "";
  // digits only — prevents path traversal
  if (!/^\d+$/.test(clubId)) return NextResponse.json({ ads: [] });

  const base = path.join(process.cwd(), "public", "promotions", clubId);
  const all = await collect(base, `/promotions/${clubId}`);
  return NextResponse.json({ ads: shuffle(all).slice(0, MAX) });
}
