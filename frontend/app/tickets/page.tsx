"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import api from "@/lib/api";

type Ticket = {
  id: number; ticket_name: string; club_name: string;
  total_punches: number; punches_left: number; valid_until: string;
  unlimited: boolean; is_valid: boolean;
};

const today = new Date().toISOString().split("T")[0];

function TicketCard({ t, done }: { t: Ticket; done?: boolean }) {
  const pct = t.total_punches > 0 ? Math.max(0, Math.min(100, Math.round((t.punches_left / t.total_punches) * 100))) : 0;
  const expired = t.valid_until < today;
  const statusLabel = expired ? "פג תוקף" : "נוצלה";
  return (
    <div className={`bg-white rounded-xl shadow p-4 ${done ? "opacity-70" : ""}`}>
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="font-semibold text-ink">{t.ticket_name}</p>
          <p className="text-sm text-muted">{t.club_name}</p>
        </div>
        <div className="text-left">
          {done && (
            <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-600">{statusLabel}</span>
          )}
          <p className="text-sm text-muted mt-1">עד {t.valid_until}</p>
        </div>
      </div>
      {t.unlimited ? (
        <p className="text-sm font-medium text-court">כניסות ללא הגבלה</p>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex-1 bg-line rounded-full h-2">
            <div className={`h-2 rounded-full ${done ? "bg-muted" : "bg-court"}`} style={{ width: `${pct}%` }} />
          </div>
          <span className={`text-sm font-medium ${done ? "text-muted" : "text-court"}`}>
            {t.punches_left}/{t.total_punches} כניסות
          </span>
        </div>
      )}
    </div>
  );
}

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/tickets/my?include_all=true")
      .then(r => setTickets(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const valid = tickets.filter(t => t.is_valid);
  const completed = tickets.filter(t => !t.is_valid);

  return (
    <main className="min-h-screen bg-mint p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-court-dark">הכרטיסיות שלי</h1>
          <Link href="/tickets/buy"
            className="bg-court text-white px-4 py-2 rounded-lg text-sm hover:bg-court-dark">
            רכישת כרטיסייה
          </Link>
        </div>

        {loading && <p className="text-center text-muted">טוען...</p>}

        {!loading && tickets.length === 0 && (
          <div className="bg-white rounded-2xl shadow p-8 text-center">
            <p className="text-muted mb-4">אין כרטיסיות</p>
            <Link href="/tickets/buy" className="bg-court text-white px-6 py-2 rounded-lg hover:bg-court-dark">
              רכוש כרטיסייה
            </Link>
          </div>
        )}

        {!loading && tickets.length > 0 && (
          <div className="space-y-8">
            {/* valid */}
            <section>
              <h2 className="text-sm font-bold text-court-dark mb-3 flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-court" />
                בתוקף ({valid.length})
              </h2>
              {valid.length > 0 ? (
                <div className="space-y-3">
                  {valid.map(t => <TicketCard key={t.id} t={t} />)}
                </div>
              ) : (
                <p className="text-sm text-muted">אין כרטיסיות בתוקף</p>
              )}
            </section>

            {/* completed / expired */}
            {completed.length > 0 && (
              <section>
                <h2 className="text-sm font-bold text-muted mb-3 flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-muted" />
                  הסתיימו ({completed.length})
                </h2>
                <div className="space-y-3">
                  {completed.map(t => <TicketCard key={t.id} t={t} done />)}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
