"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import api from "@/lib/api";

type Ticket = {
  id: number; ticket_name: string; ticket_type: string; club_name: string;
  total_punches: number; punches_left: number; valid_until: string;
  unlimited: boolean; is_valid: boolean;
};

const today = new Date().toISOString().split("T")[0];
const CREDIT_TYPE = "זיכוי";

// Group a list of credit (זיכוי) tickets by club, so many 1-punch vouchers show
// as a single line. Returns [club_name, tickets[]] entries.
function groupByClub(list: Ticket[]): [string, Ticket[]][] {
  const m = new Map<string, Ticket[]>();
  for (const t of list) {
    if (!m.has(t.club_name)) m.set(t.club_name, []);
    m.get(t.club_name)!.push(t);
  }
  return [...m.entries()];
}

// One merged card for all of a club's זיכוי credits.
function CreditCard({ club, tickets, done }: { club: string; tickets: Ticket[]; done?: boolean }) {
  // Valid credits: available count = remaining punches; show the soonest expiry.
  // Completed: just the number of vouchers.
  const count = done ? tickets.length : tickets.reduce((s, t) => s + t.punches_left, 0);
  const nearest = [...tickets].map(t => t.valid_until).sort()[0];
  return (
    <div className={`bg-white rounded-xl shadow p-4 ${done ? "opacity-70" : ""}`}>
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="font-semibold text-ink">זיכוי</p>
          <p className="text-sm text-muted">{club}</p>
        </div>
        <div className="text-left">
          {done && <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-600">הסתיימו</span>}
          {!done && <p className="text-sm text-muted mt-1">התוקף הקרוב: {nearest}</p>}
        </div>
      </div>
      <p className={`text-sm font-medium ${done ? "text-muted" : "text-court"}`}>
        {count} {count === 1 ? "יחידת זיכוי" : "יחידות זיכוי"}
      </p>
    </div>
  );
}

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
  const isCredit = (t: Ticket) => t.ticket_type === CREDIT_TYPE;
  const validOther = valid.filter(t => !isCredit(t));
  const validCredits = groupByClub(valid.filter(isCredit));
  const completedOther = completed.filter(t => !isCredit(t));
  const completedCredits = groupByClub(completed.filter(isCredit));
  const validCount = validOther.length + validCredits.length;

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
                בתוקף ({validCount})
              </h2>
              {validCount > 0 ? (
                <div className="space-y-3">
                  {validOther.map(t => <TicketCard key={t.id} t={t} />)}
                  {validCredits.map(([club, arr]) => <CreditCard key={`c-${club}`} club={club} tickets={arr} />)}
                </div>
              ) : (
                <p className="text-sm text-muted">אין כרטיסיות בתוקף</p>
              )}
            </section>

            {/* completed / expired */}
            {(completedOther.length + completedCredits.length) > 0 && (
              <section>
                <h2 className="text-sm font-bold text-muted mb-3 flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-muted" />
                  הסתיימו ({completedOther.length + completedCredits.length})
                </h2>
                <div className="space-y-3">
                  {completedOther.map(t => <TicketCard key={t.id} t={t} done />)}
                  {completedCredits.map(([club, arr]) => <CreditCard key={`cc-${club}`} club={club} tickets={arr} done />)}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
