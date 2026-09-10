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
// Not shown on this page: מנוי (subscription) and חבר מועדון (member pricing) are
// permissions, not purchasable כרטיסיות the user tracks here.
const HIDDEN_TYPES = new Set(["מנוי", "חבר מועדון"]);

type ClubGroup = { club: string; others: Ticket[]; credits: Ticket[] };

// Group a user's tickets by club. Within each club, זיכוי credits are merged
// into one entry (many 1-punch vouchers → a single line); other tickets stay
// individual. Clubs are ordered alphabetically.
function groupByClub(list: Ticket[]): ClubGroup[] {
  const m = new Map<string, { others: Ticket[]; credits: Ticket[] }>();
  for (const t of list) {
    if (!m.has(t.club_name)) m.set(t.club_name, { others: [], credits: [] });
    const g = m.get(t.club_name)!;
    (t.ticket_type === CREDIT_TYPE ? g.credits : g.others).push(t);
  }
  return [...m.entries()]
    .map(([club, g]) => ({ club, ...g }))
    .sort((a, b) => a.club.localeCompare(b.club, "he"));
}

// Number of displayed cards in a set of club groups (a club's credits = 1 card).
function cardCount(groups: ClubGroup[]): number {
  return groups.reduce((s, g) => s + g.others.length + (g.credits.length > 0 ? 1 : 0), 0);
}

// One merged card for all of a club's זיכוי credits.
function CreditCard({ tickets, done }: { tickets: Ticket[]; done?: boolean }) {
  // Valid credits: available count = remaining punches; show the soonest expiry.
  // Completed: just the number of vouchers.
  const count = done ? tickets.length : tickets.reduce((s, t) => s + t.punches_left, 0);
  const nearest = [...tickets].map(t => t.valid_until).sort()[0];
  return (
    <div className={`bg-white rounded-xl shadow p-4 ${done ? "opacity-70" : ""}`}>
      <div className="flex justify-between items-start mb-2">
        <p className="font-semibold text-ink">זיכוי</p>
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
        <p className="font-semibold text-ink">{t.ticket_name}</p>
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

// Tickets grouped under a club-name header.
function ClubGroups({ groups, done }: { groups: ClubGroup[]; done?: boolean }) {
  return (
    <div className="space-y-5">
      {groups.map(({ club, others, credits }) => (
        <div key={club} className="space-y-3">
          <h3 className="text-sm font-semibold text-ink border-b border-line pb-1">{club}</h3>
          {others.map(t => <TicketCard key={t.id} t={t} done={done} />)}
          {credits.length > 0 && <CreditCard tickets={credits} done={done} />}
        </div>
      ))}
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

  const visible = tickets.filter(t => !HIDDEN_TYPES.has((t.ticket_type || "").trim()));
  const validGroups = groupByClub(visible.filter(t => t.is_valid));
  const completedGroups = groupByClub(visible.filter(t => !t.is_valid));
  const validCount = cardCount(validGroups);
  const completedCount = cardCount(completedGroups);

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

        {!loading && visible.length === 0 && (
          <div className="bg-white rounded-2xl shadow p-8 text-center">
            <p className="text-muted mb-4">אין כרטיסיות</p>
            <Link href="/tickets/buy" className="bg-court text-white px-6 py-2 rounded-lg hover:bg-court-dark">
              רכוש כרטיסייה
            </Link>
          </div>
        )}

        {!loading && visible.length > 0 && (
          <div className="space-y-8">
            {/* valid */}
            <section>
              <h2 className="text-sm font-bold text-court-dark mb-3 flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-court" />
                בתוקף ({validCount})
              </h2>
              {validCount > 0 ? (
                <ClubGroups groups={validGroups} />
              ) : (
                <p className="text-sm text-muted">אין כרטיסיות בתוקף</p>
              )}
            </section>

            {/* completed / expired */}
            {completedCount > 0 && (
              <section>
                <h2 className="text-sm font-bold text-muted mb-3 flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-muted" />
                  הסתיימו ({completedCount})
                </h2>
                <ClubGroups groups={completedGroups} done />
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
