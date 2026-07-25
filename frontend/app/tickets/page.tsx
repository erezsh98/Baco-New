"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import api from "@/lib/api";

type Ticket = {
  id: number; ticket_name: string; club_name: string;
  total_punches: number; punches_left: number; valid_until: string;
};

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/tickets/my")
      .then(r => setTickets(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-green-50 p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-green-800">הכרטיסיות שלי</h1>
          <Link href="/tickets/buy"
            className="bg-green-700 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-800">
            רכישת כרטיסייה
          </Link>
        </div>

        {loading && <p className="text-center text-gray-500">טוען...</p>}
        {!loading && tickets.length === 0 && (
          <div className="bg-white rounded-2xl shadow p-8 text-center">
            <p className="text-gray-500 mb-4">אין כרטיסיות פעילות</p>
            <Link href="/tickets/buy" className="bg-green-700 text-white px-6 py-2 rounded-lg hover:bg-green-800">
              רכוש כרטיסייה
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {tickets.map(t => {
            const pct = Math.round((t.punches_left / t.total_punches) * 100);
            return (
              <div key={t.id} className="bg-white rounded-xl shadow p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-semibold text-gray-800">{t.ticket_name}</p>
                    <p className="text-sm text-gray-500">{t.club_name}</p>
                  </div>
                  <p className="text-sm text-gray-400">עד {t.valid_until}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-gray-200 rounded-full h-2">
                    <div className="bg-green-600 h-2 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm font-medium text-green-700">{t.punches_left}/{t.total_punches} כניסות</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
