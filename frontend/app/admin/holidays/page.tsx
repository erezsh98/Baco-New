"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";

type BlockType = "period" | "recurring";
type Block = {
  ids: number[];
  block_type: BlockType;
  court_number: number | null;   // null = all courts
  start_date: string;
  start_hour: number;
  end_date: string;
  end_hour: number;
};

const HOURS = Array.from({ length: 24 }, (_, h) => h);        // 0..23 — session start ("from")
const TO_HOURS = Array.from({ length: 24 }, (_, i) => i + 1); // 1..24 — exclusive end ("to", up to HH:00)
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

function today() {
  return new Date().toISOString().split("T")[0];
}

// A block is no longer relevant once its end date is before today.
const isPast = (b: Block) => b.end_date < today();

function describe(b: Block): string {
  if (b.block_type === "recurring")
    return `כל יום · ${b.start_date} – ${b.end_date} · ${hh(b.start_hour)}–${hh(b.end_hour)}`;
  return `${b.start_date} ${hh(b.start_hour)}  →  ${b.end_date} ${hh(b.end_hour)}`;
}

type FormState = {
  ids: number[] | null;
  block_type: BlockType;
  court_number: number | null;
  start_date: string;
  start_hour: number;
  end_date: string;
  end_hour: number;
};
const EMPTY: FormState = { ids: null, block_type: "period", court_number: null, start_date: today(), start_hour: 8, end_date: today(), end_hour: 22 };
const courtLabel = (c: number | null) => (c == null ? "כל המגרשים" : `מגרש ${c}`);

export default function HolidaysPage() {
  const router = useRouter();
  const [clubName, setClubName] = useState("");
  const [courts, setCourts] = useState<number[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(false);

  useEffect(() => { init(); }, []);

  async function init() {
    try {
      const [sched, hol] = await Promise.all([
        api.get("/admin/schedule/courts"),
        api.get("/admin/holidays"),
      ]);
      setClubName(sched.data.club_name || "");
      setCourts(sched.data.courts || []);
      setBlocks(hol.data);
    } catch (e: any) {
      if (e.response?.status === 403) { router.push("/search"); return; }
      setMsg("שגיאה בטעינת החסימות");
    } finally {
      setLoading(false);
    }
  }

  async function reload() {
    const r = await api.get("/admin/holidays");
    setBlocks(r.data);
  }

  function edit(b: Block) {
    setForm({ ids: b.ids, block_type: b.block_type, court_number: b.court_number, start_date: b.start_date, start_hour: b.start_hour, end_date: b.end_date, end_hour: b.end_hour });
    setMsg("");
  }

  function resetForm() {
    setForm({ ...EMPTY });
  }

  async function save() {
    setSaving(true); setMsg("");
    const payload = {
      block_type: form.block_type,
      court_number: form.court_number,
      start_date: form.start_date, start_hour: form.start_hour,
      end_date: form.end_date, end_hour: form.end_hour,
    };
    try {
      if (form.ids == null) await api.post("/admin/holidays", payload);
      else await api.put("/admin/holidays", { ...payload, ids: form.ids });
      setMsgOk(true);
      setMsg(form.ids == null ? "החסימה נוספה והזמינות עודכנה" : "החסימה עודכנה והזמינות עודכנה");
      resetForm();
      await reload();
    } catch (e: any) {
      setMsgOk(false);
      setMsg(e.response?.data?.detail || "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  }

  async function remove(b: Block) {
    setMsg("");
    try {
      await api.delete("/admin/holidays", { data: { ids: b.ids } });
      setMsgOk(true);
      setMsg("החסימה נמחקה והזמינות עודכנה");
      if (form.ids && b.ids.join(",") === form.ids.join(",")) resetForm();
      await reload();
    } catch (e: any) {
      setMsgOk(false);
      setMsg(e.response?.data?.detail || "שגיאה במחיקה");
    }
  }

  const recurring = form.block_type === "recurring";

  return (
    <main className="min-h-screen bg-canvas p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-ink">חסימות / ימי חג{clubName ? ` — ${clubName}` : ""}</h1>
          <Link href="/admin" className="text-sm text-court hover:underline">חזרה לניהול</Link>
        </div>

        {/* Add / edit form */}
        <div className="bg-white rounded-xl shadow p-4 mb-6">
          <h2 className="font-semibold text-ink mb-3">{form.ids == null ? "הוספת חסימה" : "עריכת חסימה"}</h2>

          {/* Block type */}
          <div className="flex flex-wrap gap-4 text-sm mb-4">
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="btype" checked={!recurring} onChange={() => setForm(f => ({ ...f, block_type: "period" }))} />
              חסימה רציפה (תקופה)
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="btype" checked={recurring} onChange={() => setForm(f => ({ ...f, block_type: "recurring" }))} />
              חסימה קבועה (אותן שעות בכל יום)
            </label>
          </div>
          <p className="text-xs text-muted mb-3">
            {recurring
              ? "חוסם את אותו טווח שעות בכל יום שבתוך טווח התאריכים."
              : "חוסם ברצף ממועד ההתחלה (תאריך ושעה) ועד מועד הסיום (תאריך ושעה)."}
          </p>

          {/* Which court */}
          <div className="mb-4">
            <span className="block text-sm font-medium text-ink mb-1">מגרש</span>
            <select
              value={form.court_number ?? ""}
              onChange={e => setForm(f => ({ ...f, court_number: e.target.value === "" ? null : Number(e.target.value) }))}
              className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court">
              <option value="">כל המגרשים</option>
              {courts.map(c => <option key={c} value={c}>מגרש {c}</option>)}
            </select>
          </div>

          {recurring ? (
            <div className="flex flex-wrap gap-6 items-end">
              <div>
                <span className="block text-sm font-medium text-ink mb-1">בתאריכים</span>
                <div className="flex gap-2 items-center">
                  <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                    className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
                  <span className="text-muted">עד</span>
                  <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                    className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
                </div>
              </div>
              <div>
                <span className="block text-sm font-medium text-ink mb-1">בשעות (כל יום)</span>
                <div className="flex gap-2 items-center">
                  <select value={form.start_hour} onChange={e => setForm(f => ({ ...f, start_hour: Number(e.target.value) }))}
                    className="border rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-court">
                    {HOURS.map(h => <option key={h} value={h}>{hh(h)}</option>)}
                  </select>
                  <span className="text-muted">עד</span>
                  <select value={form.end_hour} onChange={e => setForm(f => ({ ...f, end_hour: Number(e.target.value) }))}
                    className="border rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-court">
                    {TO_HOURS.map(h => <option key={h} value={h}>{hh(h)}</option>)}
                  </select>
                </div>
              </div>
              <button onClick={save} disabled={saving}
                className="bg-court text-white px-6 py-2 rounded-lg hover:bg-court-dark transition disabled:opacity-50">
                {saving ? "שומר..." : form.ids == null ? "הוסף" : "עדכן"}
              </button>
              {form.ids != null && <button onClick={resetForm} className="text-muted text-sm hover:underline px-2 py-2">ביטול</button>}
            </div>
          ) : (
            <div className="flex flex-wrap gap-6 items-end">
              <div>
                <span className="block text-sm font-medium text-ink mb-1">מתחילת</span>
                <div className="flex gap-2">
                  <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                    className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
                  <select value={form.start_hour} onChange={e => setForm(f => ({ ...f, start_hour: Number(e.target.value) }))}
                    className="border rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-court">
                    {HOURS.map(h => <option key={h} value={h}>{hh(h)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <span className="block text-sm font-medium text-ink mb-1">עד</span>
                <div className="flex gap-2">
                  <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                    className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
                  <select value={form.end_hour} onChange={e => setForm(f => ({ ...f, end_hour: Number(e.target.value) }))}
                    className="border rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-court">
                    {TO_HOURS.map(h => <option key={h} value={h}>{hh(h)}</option>)}
                  </select>
                </div>
              </div>
              <button onClick={save} disabled={saving}
                className="bg-court text-white px-6 py-2 rounded-lg hover:bg-court-dark transition disabled:opacity-50">
                {saving ? "שומר..." : form.ids == null ? "הוסף" : "עדכן"}
              </button>
              {form.ids != null && <button onClick={resetForm} className="text-muted text-sm hover:underline px-2 py-2">ביטול</button>}
            </div>
          )}
        </div>

        {msg && <p className={`text-sm mb-3 ${msgOk ? "text-court" : "text-red-600"}`}>{msg}</p>}
        {loading && <p className="text-center text-muted">טוען...</p>}

        {/* Existing blocks */}
        {!loading && (
          blocks.length === 0 ? (
            <p className="text-center text-muted">לא הוגדרו חסימות</p>
          ) : (
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-ink text-white">
                  <tr>
                    <th className="px-4 py-3 text-right">סוג</th>
                    <th className="px-4 py-3 text-right">מגרש</th>
                    <th className="px-4 py-3 text-right">חסימה</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {blocks.map((b, i) => (
                    <tr key={b.ids.join(",")} className={`${i % 2 === 0 ? "bg-white" : "bg-canvas"} ${isPast(b) ? "text-muted" : ""}`}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`text-xs px-2 py-1 rounded-full ${b.block_type === "recurring" ? "bg-mint text-court-dark" : "bg-court text-white"}`}>
                          {b.block_type === "recurring" ? "קבועה" : "תקופה"}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{courtLabel(b.court_number)}</td>
                      <td className="px-4 py-3">{describe(b)}</td>
                      <td className="px-4 py-3 flex gap-2 justify-end">
                        {isPast(b) ? (
                          <span className="text-xs text-muted">הסתיים</span>
                        ) : (
                          <>
                            <button onClick={() => edit(b)}
                              className="bg-mint text-court-dark px-3 py-1 rounded text-xs hover:bg-mint">ערוך</button>
                            <button onClick={() => remove(b)}
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
