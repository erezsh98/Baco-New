"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";
import { useActiveClubName } from "@/lib/useActiveClubName";

type Row = {
  id: number;
  created_at: string | null;
  user_id: number | null;
  user_name: string;
  club_id: number | null;
  club_name: string | null;
  action: string;
  summary: string;
  detail: string | null;
};

// Stable action codes → Hebrew labels + a color accent.
const ACTIONS: Record<string, { label: string; cls: string }> = {
  "schedule.save":        { label: "עדכון לוח זמנים", cls: "bg-blue-100 text-blue-800" },
  "availability.rebuild": { label: "עדכון זמינות",     cls: "bg-teal-100 text-teal-800" },
  "holiday.create":       { label: "הוספת חסימה",      cls: "bg-amber-100 text-amber-800" },
  "holiday.update":       { label: "עדכון חסימה",      cls: "bg-amber-100 text-amber-800" },
  "holiday.delete":       { label: "מחיקת חסימה",      cls: "bg-red-100 text-red-800" },
  "permission.grant":     { label: "הענקת הרשאה",      cls: "bg-green-100 text-green-800" },
  "permission.revoke":    { label: "ביטול הרשאה",      cls: "bg-red-100 text-red-800" },
  "order.cancel":         { label: "ביטול הזמנה",      cls: "bg-red-100 text-red-800" },
};

function actionLabel(a: string) { return ACTIONS[a]?.label ?? a; }
function actionCls(a: string) { return ACTIONS[a]?.cls ?? "bg-gray-100 text-gray-700"; }

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function AuditPage() {
  const router = useRouter();
  const clubName = useActiveClubName();
  const [rows, setRows] = useState<Row[]>([]);
  const [scopedClubs, setScopedClubs] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [action, setAction] = useState("");
  const [userFilter, setUserFilter] = useState("");   // client-side, by name

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function load() {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set("from_date", fromDate);
      if (toDate) params.set("to_date", toDate);
      if (action) params.set("action", action);
      const r = await api.get(`/admin/audit?${params}`);
      setRows(r.data.rows);
      setScopedClubs(r.data.scoped_to_clubs);
    } catch (e: any) {
      if (e.response?.status === 403) { router.push("/search"); return; }
      setError("שגיאה בטעינת יומן הפעולות");
    } finally {
      setLoading(false);
    }
  }

  const userNames = Array.from(new Set(rows.map(r => r.user_name).filter(Boolean))).sort();
  const shown = userFilter ? rows.filter(r => r.user_name === userFilter) : rows;

  function prettyDetail(detail: string | null): string {
    if (!detail) return "";
    try { return JSON.stringify(JSON.parse(detail), null, 2); }
    catch { return detail; }
  }

  return (
    <main className="min-h-screen bg-canvas p-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-ink">יומן פעולות מנהלים{clubName ? ` - ${clubName}` : ""}</h1>
          <Link href="/admin" className="text-sm text-court hover:underline">חזרה לניהול</Link>
        </div>

        <p className="text-sm text-muted mb-4">
          {scopedClubs === null
            ? "מוצגות פעולות של כל המועדונים."
            : "מוצגות פעולות של המועדון/ים שבניהולך בלבד."}
        </p>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow p-4 mb-4 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">מתאריך</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">עד תאריך</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">פעולה</label>
            <select value={action} onChange={e => setAction(e.target.value)}
              className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court">
              <option value="">כל הפעולות</option>
              {Object.entries(ACTIONS).map(([code, { label }]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">משתמש</label>
            <select value={userFilter} onChange={e => setUserFilter(e.target.value)}
              className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court">
              <option value="">כל המשתמשים</option>
              {userNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <button onClick={load} disabled={loading}
            className="bg-court text-white px-6 py-2 rounded-lg hover:bg-court-dark transition disabled:opacity-50 font-semibold">
            {loading ? "טוען..." : "רענן"}
          </button>
        </div>

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        {loading && <p className="text-center text-muted">טוען...</p>}

        {!loading && shown.length === 0 && (
          <p className="text-center text-muted">לא נמצאו פעולות בהתאם לסינון.</p>
        )}

        {!loading && shown.length > 0 && (
          <div className="bg-white rounded-xl shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-court text-white">
                <tr>
                  <th className="px-4 py-3 text-right whitespace-nowrap">תאריך ושעה</th>
                  <th className="px-4 py-3 text-right">משתמש</th>
                  <th className="px-4 py-3 text-right">מועדון</th>
                  <th className="px-4 py-3 text-right">פעולה</th>
                  <th className="px-4 py-3 text-right">פרטי השינוי</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.id} className={`align-top ${i % 2 === 0 ? "bg-white" : "bg-mint"}`}>
                    <td className="px-4 py-3 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                    <td className="px-4 py-3">{r.user_name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{r.club_name ?? "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${actionCls(r.action)}`}>
                        {actionLabel(r.action)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div>{r.summary}</div>
                      {r.detail && (
                        <button onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                          className="text-xs text-court hover:underline mt-1">
                          {expanded === r.id ? "הסתר פרטים" : "הצג פרטים"}
                        </button>
                      )}
                      {expanded === r.id && r.detail && (
                        <pre dir="ltr" className="mt-2 bg-canvas rounded-lg p-2 text-xs overflow-x-auto text-ink">
                          {prettyDetail(r.detail)}
                        </pre>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
