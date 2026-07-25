"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";

type Span = {
  ids: number[];
  start_date: string;
  start_hour: number;
  end_date: string;
  end_hour: number;
};

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

function today() {
  return new Date().toISOString().split("T")[0];
}

// A span is no longer relevant once its end date is before today.
const isPast = (s: Span) => s.end_date < today();

type FormState = {
  ids: number[] | null;
  start_date: string;
  start_hour: number;
  end_date: string;
  end_hour: number;
};
const EMPTY: FormState = { ids: null, start_date: today(), start_hour: 8, end_date: today(), end_hour: 22 };

export default function HolidaysPage() {
  const router = useRouter();
  const [clubName, setClubName] = useState("");
  const [spans, setSpans] = useState<Span[]>([]);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(false);

  useEffect(() => { init(); }, []);

  async function init() {
    try {
      const [courts, hol] = await Promise.all([
        api.get("/admin/schedule/courts"),
        api.get("/admin/holidays"),
      ]);
      setClubName(courts.data.club_name || "");
      setSpans(hol.data);
    } catch (e: any) {
      if (e.response?.status === 403) { router.push("/search"); return; }
      setMsg("שגיאה בטעינת ימי החג");
    } finally {
      setLoading(false);
    }
  }

  async function reload() {
    const r = await api.get("/admin/holidays");
    setSpans(r.data);
  }

  function edit(s: Span) {
    setForm({ ids: s.ids, start_date: s.start_date, start_hour: s.start_hour, end_date: s.end_date, end_hour: s.end_hour });
    setMsg("");
  }

  function resetForm() {
    setForm({ ...EMPTY });
  }

  async function save() {
    setSaving(true); setMsg("");
    const span = {
      start_date: form.start_date, start_hour: form.start_hour,
      end_date: form.end_date, end_hour: form.end_hour,
    };
    try {
      if (form.ids == null) await api.post("/admin/holidays", span);
      else await api.put("/admin/holidays", { ...span, ids: form.ids });
      setMsgOk(true);
      setMsg(form.ids == null ? "יום החג נוסף והזמינות עודכנה" : "יום החג עודכן והזמינות עודכנה");
      resetForm();
      await reload();
    } catch (e: any) {
      setMsgOk(false);
      setMsg(e.response?.data?.detail || "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  }

  async function remove(s: Span) {
    setMsg("");
    try {
      await api.delete("/admin/holidays", { data: { ids: s.ids } });
      setMsgOk(true);
      setMsg("יום החג נמחק והזמינות עודכנה");
      if (form.ids && s.ids.join(",") === form.ids.join(",")) resetForm();
      await reload();
    } catch (e: any) {
      setMsgOk(false);
      setMsg(e.response?.data?.detail || "שגיאה במחיקה");
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-800">ימי חג / סגירה{clubName ? ` — ${clubName}` : ""}</h1>
          <Link href="/admin" className="text-sm text-blue-600 hover:underline">חזרה לניהול</Link>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          החסימה רציפה ממועד ההתחלה (תאריך ושעה) ועד מועד הסיום (תאריך ושעה). המגרשים לא יופיעו בחיפוש בטווח זה. השינוי נכנס לתוקף מיד.
        </p>

        {/* Add / edit form */}
        <div className="bg-white rounded-xl shadow p-4 mb-6">
          <h2 className="font-semibold text-gray-700 mb-3">{form.ids == null ? "הוספת חסימה" : "עריכת חסימה"}</h2>
          <div className="flex flex-wrap gap-6 items-end">
            <div>
              <span className="block text-sm font-medium text-gray-700 mb-1">מתחילת</span>
              <div className="flex gap-2">
                <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                  className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <select value={form.start_hour} onChange={e => setForm(f => ({ ...f, start_hour: Number(e.target.value) }))}
                  className="border rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {HOURS.map(h => <option key={h} value={h}>{hh(h)}</option>)}
                </select>
              </div>
            </div>
            <div>
              <span className="block text-sm font-medium text-gray-700 mb-1">עד</span>
              <div className="flex gap-2">
                <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                  className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <select value={form.end_hour} onChange={e => setForm(f => ({ ...f, end_hour: Number(e.target.value) }))}
                  className="border rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {HOURS.map(h => <option key={h} value={h}>{hh(h)}</option>)}
                </select>
              </div>
            </div>
            <button onClick={save} disabled={saving}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
              {saving ? "שומר..." : form.ids == null ? "הוסף" : "עדכן"}
            </button>
            {form.ids != null && (
              <button onClick={resetForm} className="text-gray-500 text-sm hover:underline px-2 py-2">ביטול</button>
            )}
          </div>
        </div>

        {msg && <p className={`text-sm mb-3 ${msgOk ? "text-green-700" : "text-red-600"}`}>{msg}</p>}
        {loading && <p className="text-center text-gray-500">טוען...</p>}

        {/* Existing spans */}
        {!loading && (
          spans.length === 0 ? (
            <p className="text-center text-gray-500">לא הוגדרו חסימות</p>
          ) : (
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-800 text-white">
                  <tr>
                    <th className="px-4 py-3 text-right">מתחילת</th>
                    <th className="px-4 py-3 text-right">עד</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {spans.map((s, i) => (
                    <tr key={s.ids.join(",")} className={`${i % 2 === 0 ? "bg-white" : "bg-gray-50"} ${isPast(s) ? "text-gray-400" : ""}`}>
                      <td className="px-4 py-3">{s.start_date} {hh(s.start_hour)}</td>
                      <td className="px-4 py-3">{s.end_date} {hh(s.end_hour)}</td>
                      <td className="px-4 py-3 flex gap-2 justify-end">
                        {isPast(s) ? (
                          <span className="text-xs text-gray-400">הסתיים</span>
                        ) : (
                          <>
                            <button onClick={() => edit(s)}
                              className="bg-blue-100 text-blue-700 px-3 py-1 rounded text-xs hover:bg-blue-200">ערוך</button>
                            <button onClick={() => remove(s)}
                              className="bg-red-500 text-white px-3 py-1 rounded text-xs hover:bg-red-600">מחק</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </main>
  );
}
