"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";

type Club = { id: number; club_name: string };
type ActiveTime = { day_of_week: number; start_hour: number; end_hour: number };
type Ticket = {
  id: number; description: string | null; ticket_type: string | null; ticket_cost: number | null;
  total_num_of_punches: number | null; end_date: string | null; max_orders_per_day: number | null;
  active_times: ActiveTime[];
};

const DAY_LABELS: Record<number, string> = { 1: "ראשון", 2: "שני", 3: "שלישי", 4: "רביעי", 5: "חמישי", 6: "שישי", 7: "שבת" };
const EMPTY: any = { description: "", ticket_type: "", ticket_cost: "", total_num_of_punches: "", end_date: "", max_orders_per_day: "-1", active_times: [] as ActiveTime[] };

export default function SuperTicketsPage() {
  const router = useRouter();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [club, setClub] = useState<number | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [editId, setEditId] = useState<number | null>(null);   // null=list, 0=new
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [msg, setMsg] = useState(""); const [msgOk, setMsgOk] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/users/me").then(r => {
      if (!r.data.is_super_admin) { router.push("/search"); return; }
      api.get("/admin/super/clubs").then(c => { setClubs(c.data); if (c.data.length) setClub(c.data[0].id); }).catch(() => {});
    }).catch(() => router.push("/login"));
  }, []);

  useEffect(() => { if (club) { setEditId(null); loadTickets(); } }, [club]);

  function loadTickets() {
    if (!club) return;
    api.get(`/admin/super/clubs/${club}/tickets`).then(r => setTickets(r.data)).catch(() => {});
  }

  function openNew() { setEditId(0); setForm({ ...EMPTY, active_times: [] }); setMsg(""); }
  function openEdit(t: Ticket) {
    setEditId(t.id); setMsg("");
    setForm({
      description: t.description ?? "", ticket_type: t.ticket_type ?? "", ticket_cost: t.ticket_cost ?? "",
      total_num_of_punches: t.total_num_of_punches ?? "", end_date: t.end_date ?? "",
      max_orders_per_day: t.max_orders_per_day ?? "-1",
      active_times: t.active_times.map(a => ({ ...a })),
    });
  }

  function numOrNull(v: any) { return v === "" || v === null ? null : Number(v); }
  function addTime() { setForm((f: any) => ({ ...f, active_times: [...f.active_times, { day_of_week: 1, start_hour: 8, end_hour: 22 }] })); }
  function updateTime(i: number, key: keyof ActiveTime, val: number) {
    setForm((f: any) => ({ ...f, active_times: f.active_times.map((a: ActiveTime, j: number) => j === i ? { ...a, [key]: val } : a) }));
  }
  function removeTime(i: number) { setForm((f: any) => ({ ...f, active_times: f.active_times.filter((_: any, j: number) => j !== i) })); }

  async function save() {
    if (!club) return;
    setSaving(true); setMsg("");
    const payload = {
      description: form.description || null, ticket_type: form.ticket_type || null,
      ticket_cost: numOrNull(form.ticket_cost), total_num_of_punches: numOrNull(form.total_num_of_punches),
      end_date: form.end_date || null, max_orders_per_day: form.max_orders_per_day === "" ? -1 : Number(form.max_orders_per_day),
      active_times: form.active_times,
    };
    try {
      if (editId === 0) await api.post(`/admin/super/clubs/${club}/tickets`, payload);
      else await api.put(`/admin/super/tickets/${editId}`, payload);
      setMsgOk(true); setMsg("נשמר בהצלחה.");
      setEditId(null); loadTickets();
    } catch (e: any) { setMsgOk(false); setMsg(e.response?.data?.detail || "שגיאה בשמירה"); }
    finally { setSaving(false); }
  }

  async function del(t: Ticket) {
    if (!window.confirm(`למחוק את "${t.description || t.ticket_type}"?`)) return;
    try { await api.delete(`/admin/super/tickets/${t.id}`); loadTickets(); }
    catch (e: any) { setMsgOk(false); setMsg(e.response?.data?.detail || "שגיאה במחיקה"); }
  }

  const punchesLabel = (n: number | null) => n === -1000 ? "ללא הגבלה" : (n ?? "—");

  return (
    <main className="min-h-screen bg-canvas p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-ink">ניהול על — כרטיסיות וקבוצות</h1>
          <Link href="/" className="text-sm text-court hover:underline">דף הבית</Link>
        </div>

        <div className="bg-white rounded-xl shadow p-4 mb-4">
          <label className="block text-sm font-medium text-ink mb-1">מועדון</label>
          <select value={club ?? ""} onChange={e => setClub(Number(e.target.value))}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court">
            {clubs.map(c => <option key={c.id} value={c.id}>{c.club_name}</option>)}
          </select>
        </div>

        {msg && <div className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${msgOk ? "bg-mint text-court-dark border border-court/30" : "bg-red-50 text-red-700 border border-red-300"}`}>{msg}</div>}

        {club && editId === null && (
          <>
            <div className="flex justify-end mb-3">
              <button onClick={openNew} className="bg-court text-white px-4 py-2 rounded-lg hover:bg-court-dark text-sm font-semibold">כרטיסייה / קבוצה חדשה</button>
            </div>
            <div className="bg-white rounded-xl shadow overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-ink text-white"><tr>
                  <th className="px-4 py-3 text-right">תיאור</th><th className="px-4 py-3 text-right">סוג (ticket_type)</th>
                  <th className="px-4 py-3 text-right">עלות</th><th className="px-4 py-3 text-right">כניסות</th>
                  <th className="px-4 py-3 text-right">בתוקף עד</th><th className="px-4 py-3 text-right">חלונות זמן</th><th className="px-4 py-3"></th>
                </tr></thead>
                <tbody>
                  {tickets.map((t, i) => (
                    <tr key={t.id} className={i % 2 === 0 ? "bg-white" : "bg-canvas"}>
                      <td className="px-4 py-3 font-medium">{t.description || "—"}</td>
                      <td className="px-4 py-3">{t.ticket_type || "—"}</td>
                      <td className="px-4 py-3">{t.ticket_cost != null ? `₪${t.ticket_cost}` : "—"}</td>
                      <td className="px-4 py-3">{punchesLabel(t.total_num_of_punches)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{t.end_date || "—"}</td>
                      <td className="px-4 py-3">{t.active_times.length}</td>
                      <td className="px-4 py-3 text-left whitespace-nowrap">
                        <button onClick={() => openEdit(t)} className="text-court hover:underline ml-3">ערוך</button>
                        <button onClick={() => del(t)} className="text-red-600 hover:underline">מחק</button>
                      </td>
                    </tr>
                  ))}
                  {tickets.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">אין כרטיסיות/קבוצות למועדון זה.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}

        {club && editId !== null && (
          <div className="bg-white rounded-xl shadow p-4">
            <h2 className="font-semibold text-ink mb-4">{editId === 0 ? "כרטיסייה / קבוצה חדשה" : "עריכה"}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">תיאור</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">סוג (ticket_type)</label>
                <input value={form.ticket_type} onChange={e => setForm({ ...form, ticket_type: e.target.value })}
                  placeholder="מספר לכרטיסייה, או מנוי / חבר מועדון / זיכוי לקבוצה"
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">עלות (₪)</label>
                <input type="number" value={form.ticket_cost} onChange={e => setForm({ ...form, ticket_cost: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">מספר כניסות (-1000 = ללא הגבלה)</label>
                <input type="number" value={form.total_num_of_punches} onChange={e => setForm({ ...form, total_num_of_punches: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">בתוקף עד</label>
                <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">מקס' הזמנות ליום (-1 = ללא)</label>
                <input type="number" value={form.max_orders_per_day} onChange={e => setForm({ ...form, max_orders_per_day: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
              </div>
            </div>

            {/* active-time windows */}
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-ink">חלונות זמן פעילים (ticket_active_time)</h3>
                <button onClick={addTime} className="text-sm text-court hover:underline">+ הוסף חלון</button>
              </div>
              <p className="text-xs text-muted mb-2">הכרטיסייה תקפה להזמנה רק בימים/שעות אלה. ריק = ללא חלונות (לא זמין להזמנה רגילה).</p>
              {form.active_times.length === 0 && <p className="text-sm text-muted">לא הוגדרו חלונות זמן.</p>}
              <div className="space-y-2">
                {form.active_times.map((a: ActiveTime, i: number) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <select value={a.day_of_week} onChange={e => updateTime(i, "day_of_week", Number(e.target.value))}
                      className="border rounded-lg px-2 py-1 text-sm">
                      {[1, 2, 3, 4, 5, 6, 7].map(d => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
                    </select>
                    <span className="text-sm text-muted">משעה</span>
                    <input type="number" min={0} max={23} value={a.start_hour} onChange={e => updateTime(i, "start_hour", Number(e.target.value))}
                      className="w-16 border rounded-lg px-2 py-1 text-sm" />
                    <span className="text-sm text-muted">עד</span>
                    <input type="number" min={0} max={23} value={a.end_hour} onChange={e => updateTime(i, "end_hour", Number(e.target.value))}
                      className="w-16 border rounded-lg px-2 py-1 text-sm" />
                    <button onClick={() => removeTime(i)} className="text-red-500 hover:text-red-700 text-lg leading-none">×</button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setEditId(null)} className="px-5 py-2 rounded-lg border border-line hover:bg-canvas text-sm">ביטול</button>
              <button onClick={save} disabled={saving}
                className="bg-court text-white px-6 py-2 rounded-lg hover:bg-court-dark disabled:opacity-50 text-sm font-semibold">
                {saving ? "שומר..." : "שמור"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
