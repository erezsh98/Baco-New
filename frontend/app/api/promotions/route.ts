import { NextResponse } from "next/server";
import { readdir } from "fs/promises";
import path from "path";

// Lists promotion banners for a club from public/promotions/<club_id>/.
// v1: no DB — just drop JPEGs into the folder. Up to 8 per club, sorted by
// filename (prefix 01-, 02-, ... to control order).
const MAX_PER_CLUB = 8;
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clubId = searchParams.get("club_id") || "";

  // digits only — prevents path traversal
  if (!/^\d+$/.test(clubId)) {
    return NextResponse.json({ promotions: [] });
  }

  const dir = path.join(process.cwd(), "public", "promotions", clubId);
  try {
    const files = (await readdir(dir))
      .filter((f) => IMAGE_RE.test(f) && !f.startsWith("."))
      .sort()
      .slice(0, MAX_PER_CLUB);
    const promotions = files.map((f) => ({
      src: `/promotions/${clubId}/${f}`,
      name: f.replace(IMAGE_RE, ""),
    }));
    return NextResponse.json({ promotions });
  } catch {
    // folder doesn't exist / no promotions for this club
    return NextResponse.json({ promotions: [] });
  }
}
