"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Promo = { src: string; name: string };

function PromoGrid({ title, icon, items }: { title: string; icon: string; items: Promo[] }) {
  if (items.length === 0) return null;
  return (
    <section className="w-full rounded-2xl bg-white/60 p-4 shadow-sm ring-1 ring-line">
      <div className="mb-4 flex items-center justify-between border-b-2 border-court/25 pb-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-court-dark">
          <span className="text-xl">{icon}</span>{title}
        </h2>
        <span className="text-xs text-muted">מודעה</span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {items.map((p) => (
          <div key={p.src} className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.src} alt={p.name} className="block h-auto w-full" loading="lazy" />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ThankYouPage() {
  const [slotInfo, setSlotInfo] = useState<string>("");
  const [business, setBusiness] = useState<Promo[]>([]);
  const [coaches, setCoaches] = useState<Promo[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("last_booking");
    if (saved) {
      const b = JSON.parse(saved);
      const mm = String(b.minutes_offset ?? 0).padStart(2, "0");
      setSlotInfo(`${b.club_name} — ${b.date} ${String(b.hour).padStart(2, "0")}:${mm}`);
      if (b.club_id) {
        fetch(`/api/promotions?club_id=${b.club_id}`)
          .then((r) => r.json())
          .then((d) => { setBusiness(d.business || []); setCoaches(d.coaches || []); })
          .catch(() => {});
      }
      localStorage.removeItem("last_booking");
    }
    localStorage.removeItem("selected_slot");
  }, []);

  return (
    <main className="min-h-screen bg-mint p-4">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 py-4">
        {/* confirmation */}
        <div className="w-full rounded-2xl bg-white p-8 text-center shadow-lg">
          <div className="mb-4 text-6xl">🎾</div>
          <h1 className="mb-2 text-2xl font-bold text-court-dark">ההזמנה אושרה!</h1>
          {slotInfo && <p className="mb-4 text-sm text-muted">{slotInfo}</p>}
          <p className="mb-6 text-sm text-muted">פרטי ההזמנה נשלחו לאימייל שלך.</p>
          <div className="flex flex-col gap-3">
            <Link href="/my-bookings" className="rounded-lg bg-court py-2 text-white transition hover:bg-court-dark">ההזמנות שלי</Link>
            <Link href="/search" className="rounded-lg border border-court py-2 text-court transition hover:bg-mint">חפש מגרש נוסף</Link>
          </div>
        </div>

        {/* up to 8 local-business promotions for this club */}
        <PromoGrid title="עסקים מומלצים בקרבת המועדון" icon="🏪" items={business} />

        {/* up to 8 tennis coaches & players */}
        <PromoGrid title="מאמנים ושחקנים" icon="🎾" items={coaches} />
      </div>
    </main>
  );
}
