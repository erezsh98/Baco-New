"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function ThankYouPage() {
  const [slotInfo, setSlotInfo] = useState<string>("");

  useEffect(() => {
    const saved = localStorage.getItem("last_booking");
    if (saved) {
      const b = JSON.parse(saved);
      setSlotInfo(`${b.club_name} — ${b.date} ${b.hour}:00`);
      localStorage.removeItem("last_booking");
    }
    localStorage.removeItem("selected_slot");
  }, []);

  return (
    <main className="min-h-screen bg-mint flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
        <div className="text-6xl mb-4">🎾</div>
        <h1 className="text-2xl font-bold text-court-dark mb-2">ההזמנה אושרה!</h1>
        {slotInfo && <p className="text-muted mb-4 text-sm">{slotInfo}</p>}
        <p className="text-muted text-sm mb-6">פרטי ההזמנה נשלחו לאימייל שלך.</p>
        <div className="flex flex-col gap-3">
          <Link href="/my-bookings"
            className="bg-court text-white py-2 rounded-lg hover:bg-court-dark transition">
            ההזמנות שלי
          </Link>
          <Link href="/search"
            className="border border-court text-court py-2 rounded-lg hover:bg-mint transition">
            חפש מגרש נוסף
          </Link>
        </div>
      </div>
    </main>
  );
}
