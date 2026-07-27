"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";

// Distinct colors for price tiers (index → color).
const PALETTE = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6",
  "#14b8a6", "#ef4444", "#a855f7", "#0ea5e9", "#f97316",
];
const DAYS = [1, 2, 3, 4, 5, 6, 7];
const DAY_LABELS: Record<number, string> = {
  1: "ראשון", 2: "שני", 3: "שלישי", 4: "רביעי", 5: "חמישי", 6: "שישי", 7: "שבת",
};

type Tier = { id: number; color: string; member: number; nonMember: number };
type Cell = { tier: number; offset: number };
// The active tool is exclusive: painting either changes the color/cost
// (preserving each cell's offset) OR the offset (preserving each cell's color).
type Brush =
  | { kind: "tier"; id: number }
  | { kind: "offset"; value: number }
  | { kind: "block" };
const OFFSETS = [0, 15, 30, 45];

export default function SchedulePage() {
  const router = useRouter();
  const [clubName, setClubName] = useState("");
  const [courts, setCourts] = useState<number[]>([]);
  const [court, setCourt] = useState<number | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [priceMode, setPriceMode] = useState<"same" | "different">("same");
  const [hourFrom, setHourFrom] = useState(6);
  const [hourTo, setHourTo] = useState(23);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [grid, setGrid] = useState<Record<string, Cell>>({}); // `${day}-${hour}` -> { tier, offset }
  const [brush, setBrush] = useState<Brush>({ kind: "block" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(false);
  const painting = useRef(false);
  const nextTierId = useRef(1);

  useEffect(() => { loadCourts(); }, []);
  useEffect(() => {
    const up = () => { painting.current = false; };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);
  useEffect(() => { if (court != null) loadMatrix(court); }, [court]);

  async function loadCourts() {
    try {
      const r = await api.get("/admin/schedule/courts");
      setClubName(r.data.club_name);
      const cs: number[] = r.data.courts?.length ? r.data.courts : [1];
      setCourts(cs);
      setCourt(cs[0]);
    } catch (e: any) {
      if (e.response?.status === 403) router.push("/search");
      else { setMsg("שגיאה בטעינת המגרשים"); setLoading(false); }
    }
  }

  async function loadMatrix(c: number) {
    setLoading(true); setMsg("");
    try {
      const r = await api.get(`/admin/schedule/matrix?court_number=${c}`);
      const d = r.data;
      setStartDate(d.start_date); setEndDate(d.end_date);
      setPriceMode(d.price_mode); setHourFrom(d.hour_from); setHourTo(d.hour_to);

      const combos = new Map<string, Tier>();
      const g: Record<string, Cell> = {};
      let idc = 1;
      for (const cell of d.cells) {
        const key = `${cell.member_price}-${cell.non_member_price}`;
        let t = combos.get(key);
        if (!t) {
          t = { id: idc, color: PALETTE[(idc - 1) % PALETTE.length], member: cell.member_price, nonMember: cell.non_member_price };
          combos.set(key, t); idc++;
        }
        g[`${cell.day}-${cell.hour}`] = { tier: t.id, offset: cell.minutes_offset ?? 0 };
      }
      nextTierId.current = idc;
      const arr = [...combos.values()];
      setTiers(arr);
      setBrush(arr.length ? { kind: "tier", id: arr[0].id } : { kind: "block" });
      setGrid(g);
    } catch (e: any) {
      if (e.response?.status === 403) router.push("/search");
      else setMsg("שגיאה בטעינת לוח הזמנים");
    } finally {
      setLoading(false);
    }
  }

  function applyBrush(day: number, hour: number) {
    const key = `${day}-${hour}`;
    setGrid(prev => {
      const n = { ...prev };
      const existing = n[key];
      if (brush.kind === "block") {
        delete n[key];
      } else if (brush.kind === "tier") {
        // change color/cost; preserve the cell's current offset
        n[key] = { tier: brush.id, offset: existing ? existing.offset : 0 };
      } else {
        // offset tool: change offset only; preserve color. Ignore blocked cells.
        if (existing) n[key] = { ...existing, offset: brush.value };
      }
      return n;
    });
  }

  function addTier() {
    const color = PALETTE[(nextTierId.current - 1) % PALETTE.length];
    const last = tiers[tiers.length - 1];
    const t: Tier = { id: nextTierId.current, color, member: last ? last.member : 0, nonMember: last ? last.nonMember : 0 };
    nextTierId.current++;
    setTiers(p => [...p, t]);
    setBrush({ kind: "tier", id: t.id });
  }

  function updateTier(id: number, field: "member" | "nonMember", val: number) {
    setTiers(p => p.map(t => {
      if (t.id !== id) return t;
      if (priceMode === "same") return { ...t, member: val, nonMember: val };
      return { ...t, [field]: val };
    }));
  }

  function removeTier(id: number) {
    setTiers(p => p.filter(t => t.id !== id));
    setGrid(prev => {
      const n: Record<string, Cell> = {};
      for (const k in prev) if (prev[k].tier !== id) n[k] = prev[k];
      return n;
    });
    if (brush.kind === "tier" && brush.id === id) setBrush({ kind: "block" });
  }

  function changeMode(m: "same" | "different") {
    setPriceMode(m);
    if (m === "same") setTiers(p => p.map(t => ({ ...t, nonMember: t.member })));
  }

  async function save() {
    if (court == null) return;
    setSaving(true); setMsg("");
    const byId = new Map(tiers.map(t => [t.id, t]));
    const cells: any[] = [];
    for (const key in grid) {
      const cell = grid[key];
      const t = byId.get(cell.tier);
      if (!t) continue;
      const [day, hour] = key.split("-").map(Number);
      cells.push({ day, hour, member_price: t.member, non_member_price: t.nonMember, minutes_offset: cell.offset });
    }
    try {
      const r = await api.post("/admin/schedule/matrix", {
        court_number: court, start_date: startDate, end_date: endDate, price_mode: priceMode, cells,
      });
      setMsgOk(true);
      setMsg(r.data.message || "נשמר");
      await loadMatrix(court);
    } catch (e: any) {
      setMsgOk(false);
      setMsg(e.response?.data?.detail || "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  }

  const hours: number[] = [];
  for (let h = hourFrom; h <= hourTo; h++) hours.push(h);

  function cellColor(day: number, hour: number): string {
    const c = grid[`${day}-${hour}`];
    if (!c) return "#f3f4f6";
    return tiers.find(t => t.id === c.tier)?.color ?? "#f3f4f6";
  }

  function cellOffset(day: number, hour: number): number {
    return grid[`${day}-${hour}`]?.offset ?? 0;
  }

  return (
    <main className="min-h-screen bg-canvas p-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-ink">עריכת לוח זמנים — {clubName}</h1>
          <Link href="/admin" className="text-sm text-court hover:underline">חזרה לניהול</Link>
        </div>

        {/* Controls */}
        <div className="bg-white rounded-xl shadow p-4 mb-4 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">מגרש</label>
            <select value={court ?? ""} onChange={e => setCourt(Number(e.target.value))}
              className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court">
              {courts.map(c => <option key={c} value={c}>מגרש {c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">מתאריך</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">עד תאריך</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
          </div>
          <div>
            <span className="block text-sm font-medium text-ink mb-1">מחיר</span>
            <div className="flex gap-3 text-sm py-2">
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" checked={priceMode === "same"} onChange={() => changeMode("same")} /> אחיד
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" checked={priceMode === "different"} onChange={() => changeMode("different")} /> חבר / לא-חבר
              </label>
            </div>
          </div>
        </div>

        {/* Palette / brushes */}
        <div className="bg-white rounded-xl shadow p-4 mb-4">
          <p className="text-sm mb-3">
            כלי פעיל:{" "}
            <span className="font-bold text-ink">
              {brush.kind === "tier"
                ? "צביעת מחיר (צבע)"
                : brush.kind === "offset"
                  ? `סימון היסט ${brush.value === 0 ? "00" : ":" + brush.value}`
                  : "חסימה / מחיקה"}
            </span>
            <span className="text-muted"> — לחץ או גרור על התאים</span>
          </p>

          {/* Color / cost tools */}
          <div className={`flex flex-wrap gap-3 items-center rounded-lg p-2 ${brush.kind === "tier" ? "bg-canvas ring-1 ring-line" : ""}`}>
            <span className="text-xs font-semibold text-muted">מחיר (צבע):</span>
            {tiers.map(t => (
              <div key={t.id}
                className={`flex items-center gap-2 border rounded-lg p-2 ${brush.kind === "tier" && brush.id === t.id ? "ring-2 ring-offset-1 ring-ink" : ""}`}>
                <button type="button" onClick={() => setBrush({ kind: "tier", id: t.id })}
                  className="w-6 h-6 rounded" style={{ background: t.color }} title="בחר צבע זה (מצב צביעת מחיר)" />
                {priceMode === "same" ? (
                  <span className="flex items-center gap-1 text-sm">₪
                    <input type="number" value={t.member} onChange={e => updateTier(t.id, "member", Number(e.target.value))}
                      className="w-16 border rounded px-1 py-0.5" /></span>
                ) : (
                  <span className="flex items-center gap-1 text-xs">
                    חבר ₪<input type="number" value={t.member} onChange={e => updateTier(t.id, "member", Number(e.target.value))}
                      className="w-14 border rounded px-1 py-0.5" />
                    לא-חבר ₪<input type="number" value={t.nonMember} onChange={e => updateTier(t.id, "nonMember", Number(e.target.value))}
                      className="w-14 border rounded px-1 py-0.5" />
                  </span>
                )}
                <button type="button" onClick={() => removeTier(t.id)}
                  className="text-red-500 hover:text-red-700 text-lg leading-none" title="מחק מחיר">×</button>
              </div>
            ))}
            <button type="button" onClick={addTier}
              className="border border-dashed rounded-lg px-3 py-2 text-sm text-court hover:bg-mint">+ הוסף מחיר</button>
            <button type="button" onClick={() => setBrush({ kind: "block" })}
              className={`border rounded-lg px-3 py-2 text-sm ${brush.kind === "block" ? "ring-2 ring-offset-1 ring-ink bg-mint" : ""}`}
              title="סמן תאים לחסימה">
              <span className="inline-block w-4 h-4 rounded align-middle mr-1" style={{ background: "#f3f4f6", border: "1px solid #d1d5db" }} /> חסום / מחק
            </button>
          </div>

          {/* Offset tool — separate mode: paints only the start-minutes, keeps color */}
          <div className={`mt-3 flex flex-wrap items-center gap-3 text-sm rounded-lg p-2 ${brush.kind === "offset" ? "bg-canvas ring-1 ring-line" : ""}`}>
            <span className="font-medium text-ink">היסט התחלה (דקות אחרי השעה):</span>
            {OFFSETS.map(o => (
              <label key={o} className="flex items-center gap-1 cursor-pointer">
                <input type="radio" name="offset" checked={brush.kind === "offset" && brush.value === o} onChange={() => setBrush({ kind: "offset", value: o })} />
                {o === 0 ? "00 (ללא סימון)" : `:${o}`}
              </label>
            ))}
            <span className="text-xs text-muted">בחירת היסט משנה רק את דקות ההתחלה של התאים שתסמן — הצבע/המחיר נשמר</span>
          </div>
        </div>

        {msg && <p className={`text-sm mb-3 ${msgOk ? "text-court" : "text-red-600"}`}>{msg}</p>}
        {loading && <p className="text-center text-muted">טוען...</p>}

        {/* Matrix */}
        {!loading && (
          <div className="bg-white rounded-xl shadow p-4 overflow-x-auto">
            <table className="border-collapse select-none mx-auto" onDragStart={e => e.preventDefault()}>
              <thead>
                <tr>
                  <th className="p-2 text-xs text-muted sticky right-0 bg-white">שעה</th>
                  {DAYS.map(d => (
                    <th key={d} className="p-2 text-xs font-medium text-ink" style={{ minWidth: 64 }}>{DAY_LABELS[d]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hours.map(h => (
                  <tr key={h}>
                    <td className="p-1 text-xs text-muted text-center sticky right-0 bg-white">
                      {String(h).padStart(2, "0")}:00
                    </td>
                    {DAYS.map(d => (
                      <td key={d} style={{ padding: 0 }}>
                        <div
                          onMouseDown={() => { painting.current = true; applyBrush(d, h); }}
                          onMouseEnter={() => { if (painting.current) applyBrush(d, h); }}
                          className="cursor-pointer hover:opacity-80"
                          style={{ height: 28, minWidth: 60, background: cellColor(d, h), border: "1px solid #fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff" }}
                          title={`${DAY_LABELS[d]} ${String(h).padStart(2, "0")}:${String(cellOffset(d, h)).padStart(2, "0")}`}
                        >
                          {grid[`${d}-${h}`] && cellOffset(d, h) > 0 ? cellOffset(d, h) : ""}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button onClick={save} disabled={saving || loading}
            className="bg-court text-white px-8 py-3 rounded-lg hover:bg-court-dark transition disabled:opacity-50 font-semibold">
            {saving ? "שומר ובונה זמינות..." : "שמור"}
          </button>
        </div>
      </div>
    </main>
  );
}
