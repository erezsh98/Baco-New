"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import api from "@/lib/api";

type Booking = {
  id: number; club_name: string; court_number: number;
  date: string; hour: number; minutes_offset: number;
  status: string; total_price: number;
};

export default function MyBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    loadBookings();
  }, []);

  async function loadBookings() {
    setLoading(true);
    try {
      const res = await api.get("/bookings/my?future=true");
      setBookings(res.data);
    } catch {
      setError("שגיאה בטעינת ההזמנות");
    } finally {
      setLoading(false);
    }
  }

  async function cancel(id: number) {
    setCancelId(id);
    try {
      await api.post(`/bookings/${id}/cancel`);
      setBookings(b => b.filter(x => x.id !== id));
    } catch (e: any) {
      setError(e.response?.data?.detail || "שגיאה בביטול");
    } finally {
      setCancelId(null);
    }
  }

  return (
    <main className="min-h-screen bg-green-50 p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-green-800">הזמנות עתידיות</h1>
          <Link href="/my-bookings/past" className="text-sm text-green-700 hover:underline">הזמנות עבר</Link>
        </div>

        {error && <p className="text-red-600 text-sm mb-4 text-center">{error}</p>}
        {loading && <p className="text-center text-gray-500">טוען...</p>}

        {!loading && bookings.length === 0 && (
          <div className="bg-white rounded-2xl shadow p-8 text-center">
            <p className="text-gray-500 mb-4">אין הזמנות עתידיות</p>
            <Link href="/search" className="bg-green-700 text-white px-6 py-2 rounded-lg hover:bg-green-800">
              חפש מגרש
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {bookings.map(b => (
            <div key={b.id} className="bg-white rounded-xl shadow p-4 flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-gray-800">{b.club_name} — מגרש {b.court_number}</p>
                <p className="text-sm text-gray-500">{b.date} | {b.hour}:{String(b.minutes_offset).padStart(2, "0")}</p>
                <p className="text-sm text-green-700 font-medium">₪{b.total_price}</p>
              </div>
              <button onClick={() => cancel(b.id)} disabled={cancelId === b.id}
                className="bg-red-500 text-white px-3 py-1 rounded-lg text-sm hover:bg-red-600 transition disabled:opacity-50">
                {cancelId === b.id ? "מבטל..." : "ביטול"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
