"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Promo = { src: string; name: string };

export default function ThankYouPage() {
  const [slotInfo, setSlotInfo] = useState<string>("");
  const [ads, setAds] = useState<Promo[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("last_booking");
    if (saved) {
      const b = JSON.parse(saved);
      const mm = String(b.minutes_offset ?? 0).padStart(2, "0");
      setSlotInfo(`${b.club_name} — ${b.date} ${String(b.hour).padStart(2, "0")}:${mm}`);
      if (b.club_id) {
        // All promos for this club (up to 20), reshuffled server-side on every
        // booking so a different ad rotates into the top slots each time.
        fetch(`/api/promotions?club_id=${b.club_id}`)
          .then((r) => r.json())
          .then((d) => setAds(d.ads || []))
          .catch(() => {});
      }
      localStorage.removeItem("last_booking");
    }
    localStorage.removeItem("selected_slot");
  }, []);

  return (
    <main className="min-h-screen bg-mint p-3">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 py-2">
        {/* Compact confirmation — kept small so the promos sit above the fold */}
        <div className="w-full rounded-2xl bg-white p-4 text-center shadow">
          <div className="text-3xl leading-none">🎾</div>
          <h1 className="mt-1 text-lg font-bold text-court-dark">ההזמנה אושרה!</h1>
          {slotInfo && <p className="mt-0.5 text-xs text-muted">{slotInfo}</p>}
          <p className="mt-0.5 text-xs text-muted">פרטי ההזמנה נשלחו לאימייל שלך.</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Link href="/my-bookings" className="rounded-lg bg-court px-4 py-1.5 text-sm text-white transition hover:bg-court-dark">
              ההזמנות שלי
            </Link>
            <Link href="/search" className="rounded-lg border border-court px-4 py-1.5 text-sm text-court transition hover:bg-mint">
              חפש מגרש נוסף
            </Link>
          </div>
        </div>

        {/* Single promo section — all ads, 3 per row. The first 6 fill the phone
            screen without scrolling; the rest are seen by scrolling down. */}
        {ads.length > 0 && (
          <section className="w-full rounded-2xl bg-white/60 p-3 shadow-sm ring-1 ring-line">
            <div className="mb-2 flex items-center justify-between border-b-2 border-court/25 pb-1.5">
              <h2 className="flex items-center gap-1.5 text-base font-bold text-court-dark">
                <span>🏪</span>עסקים מומלצים באזור
              </h2>
              <span className="text-[11px] text-muted">מודעה</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {ads.map((p) => (
                <div key={p.src} className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.src} alt={p.name} className="block aspect-square w-full object-cover" loading="lazy" />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
