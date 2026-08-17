import { NextResponse } from "next/server";
import { readdir } from "fs/promises";
import path from "path";

// Promotion banners for a club, in two sections, from:
//   public/promotions/<club_id>/business/   → local businesses near the court
//   public/promotions/<club_id>/coaches/    → tennis coaches & players
// v1: no DB — just drop JPEG/PNG/WebP files into the folder. Up to 8 per section,
// sorted by filename (prefix 01-, 02-, … to control order). Loose images placed
// directly in <club_id>/ are treated as business (backward compatibility).
const MAX_PER_SECTION = 8;
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

type Promo = { src: string; name: string };

async function listImages(dir: string, urlBase: string): Promise<Promo[]> {
  try {
    const files = (await readdir(dir))
      .filter((f) => IMAGE_RE.test(f) && !f.startsWith("."))
      .sort();
    return files.map((f) => ({ src: `${urlBase}/${f}`, name: f.replace(IMAGE_RE, "") }));
  } catch {
    return []; // folder doesn't exist
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clubId = searchParams.get("club_id") || "";

  // digits only — prevents path traversal
  if (!/^\d+$/.test(clubId)) {
    return NextResponse.json({ business: [], coaches: [] });
  }

  const base = path.join(process.cwd(), "public", "promotions", clubId);
  const [loose, businessSub, coaches] = await Promise.all([
    listImages(base, `/promotions/${clubId}`),                               // backward-compat
    listImages(path.join(base, "business"), `/promotions/${clubId}/business`),
    listImages(path.join(base, "coaches"), `/promotions/${clubId}/coaches`),
  ]);

  const business = [...loose, ...businessSub].slice(0, MAX_PER_SECTION);
  return NextResponse.json({ business, coaches: coaches.slice(0, MAX_PER_SECTION) });
}
