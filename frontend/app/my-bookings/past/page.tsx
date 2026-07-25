"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import api from "@/lib/api";

type Booking = {
  id: number; club_name: string; court_number: number;
  date: string; hour: number; minutes_offset: number;
  status: string; total_price: number;
};

export default function PastBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/bookings/my?future=false")
      .then(r => setBookings(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-green-50 p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-green-800">הזמנות עבר</h1>
          <Link href="/my-bookings" className="text-sm text-green-700 hover:underline">הזמנות עתידיות</Link>
        </div>

        {loading && <p className="text-center text-gray-500">טוען...</p>}
        {!loading && bookings.length === 0 && (
          <p className="text-center text-gray-500">לא נמצאו הזמנות קודמות</p>
        )}

        <div className="space-y-3">
          {bookings.map(b => (
            <div key={b.id} className="bg-white rounded-xl shadow p-4 flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-gray-800">{b.club_name} — מגרש {b.court_number}</p>
                <p className="text-sm text-gray-500">{b.date} | {b.hour}:{String(b.minutes_offset).padStart(2, "0")}</p>
                <p className="text-sm text-green-700 font-medium">₪{b.total_price}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${b.status === "canceled" ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-600"}`}>
                {b.status === "canceled" ? "מבוטל" : "הושלם"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
