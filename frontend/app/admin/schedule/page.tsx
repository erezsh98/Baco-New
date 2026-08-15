"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
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
const OFFSETS = [0, 15, 30, 45];
const RENEW_END = "2050-12-31";
const PERIODS_PER_PAGE = 10;
const SURFACES = ["קשה", "חימר", "דשא"];   // court surface types (fixed dropdown)

type Tier = { id: number; color: string; member: number; nonMember: number };
type Cell = { tier: number; offset: number };
type Brush = { kind: "tier"; id: number } | { kind: "offset"; value: number } | { kind: "block" };
type CourtInfo = { court_number: number; model: "auto" | "period" };
type Period = { start_date: string; end_date: string; status: "future" | "active" | "ended"; editable: boolean };
type Conflict = { date: string; hour: number; order_id: number; customer: string };
type Pending = { type: "save" | "delete"; period?: Period; conflicts: Conflict[] };

const STATUS_LABEL: Record<string, string> = { future: "עתידי", active: "פעיל", ended: "הסתיים" };
const STATUS_CLS: Record<string, string> = {
  future: "bg-blue-100 text-blue-800", active: "bg-green-100 text-green-800", ended: "bg-gray-200 text-gray-600",
};

export default function SchedulePage() {
  const router = useRouter();
  const today = new Date().toISOString().split("T")[0];

  const [clubName, setClubName] = useState("");
  const [courts, setCourts] = useState<CourtInfo[]>([]);
  const [court, setCourt] = useState<number | null>(null);

  const [model, setModel] = useState<"auto" | "period">("auto");
  const [serverModel, setServerModel] = useState<"auto" | "period">("auto");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodView, setPeriodView] = useState<"list" | "editor">("list");
  const [periodPage, setPeriodPage] = useState(0);   // pagination for the periods list
  const [surfaceType, setSurfaceType] = useState("");   // court-level surface

  // editor state
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [origStart, setOrigStart] = useState<string | null>(null);
  const [origEnd, setOrigEnd] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [priceMode, setPriceMode] = useState<"same" | "different">("same");
  const [hourFrom, setHourFrom] = useState(6);
  const [hourTo, setHourTo] = useState(23);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [grid, setGrid] = useState<Record<string, Cell>>({});
  const [brush, setBrush] = useState<Brush>({ kind: "block" });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  // Edit lifecycle: `dirty` = unsaved grid/date edits; `savedPendingExpose` =
  // saved this session but not yet exposed to users (חשוף שינויים למשתמשים).
  const [dirty, setDirty] = useState(false);
  const [savedPendingExpose, setSavedPendingExpose] = useState(false);

  const painting = useRef(false);
  const nextTierId = useRef(1);

  useEffect(() => { loadCourts(); }, []);
  useEffect(() => {
    const up = () => { painting.current = false; };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);
  // Warn on browser-level leave (tab close / refresh / external nav) while there
  // are unsaved edits or saved-but-not-exposed changes. (Browsers show their own
  // generic text; the tailored Hebrew messages appear on in-app navigation.)
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty || savedPendingExpose) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, savedPendingExpose]);
  useEffect(() => { if (court != null) loadCourt(court); /* eslint-disable-next-line */ }, [court]);

  async function loadCourts() {
    try {
      const r = await api.get("/admin/schedule/courts");
      setClubName(r.data.club_name);
      const cs: CourtInfo[] = r.data.courts?.length ? r.data.courts : [{ court_number: 1, model: "auto" }];
      setCourts(cs);
      setCourt(cs[0].court_number);
    } catch (e: any) {
      if (e.response?.status === 403) router.push("/search");
      else { setMsg("שגיאה בטעינת המגרשים"); setLoading(false); }
    }
  }

  async function loadCourt(c: number) {
    setLoading(true); setMsg(""); setPending(null);
    setDirty(false); setSavedPendingExpose(false); setPeriodPage(0);
    try {
      const r = await api.get(`/admin/schedule/court?court_number=${c}`);
      const d = r.data;
      setModel(d.model); setServerModel(d.model);
      setSurfaceType(d.surface_type || "");
      if (d.model === "auto") {
        loadGrid(d.cells, d.price_mode, d.hour_from, d.hour_to);
        setStartDate(d.start_date); setEndDate(d.end_date);
        setOrigStart(null); setOrigEnd(null); setReadOnly(false);
      } else {
        setPeriods(d.periods || []);
        setPeriodView("list");
      }
    } catch (e: any) {
      if (e.response?.status === 403) router.push("/search");
      else setMsg("שגיאה בטעינת לוח הזמנים");
    } finally {
      setLoading(false);
    }
  }

  // Build tiers + grid from a server cells array. Ensures at least one price tier.
  function loadGrid(cells: any[], price_mode: string, hour_from: number, hour_to: number) {
    setPriceMode(price_mode || "same");
    setHourFrom(hour_from ?? 6); setHourTo(hour_to ?? 23);
    const combos = new Map<string, Tier>();
    const g: Record<string, Cell> = {};
    let idc = 1;
    for (const cell of cells || []) {
      const key = `${cell.member_price}-${cell.non_member_price}`;
      let t = combos.get(key);
      if (!t) {
        t = { id: idc, color: PALETTE[(idc - 1) % PALETTE.length], member: cell.member_price, nonMember: cell.non_member_price };
        combos.set(key, t); idc++;
      }
      g[`${cell.day}-${cell.hour}`] = { tier: t.id, offset: cell.minutes_offset ?? 0 };
    }
    let arr = [...combos.values()];
    if (arr.length === 0) {   // seed a default tier so the grid is paintable
      arr = [{ id: 1, color: PALETTE[0], member: 0, nonMember: 0 }];
      idc = 2;
    }
    nextTierId.current = idc;
    setTiers(arr);
    setBrush({ kind: "tier", id: arr[0].id });
    setGrid(g);
  }

  function seedEmptyGrid() {
    setPriceMode("same"); setHourFrom(6); setHourTo(23);
    const t = { id: 1, color: PALETTE[0], member: 0, nonMember: 0 };
    nextTierId.current = 2;
    setTiers([t]); setBrush({ kind: "tier", id: 1 }); setGrid({}); setDirty(false);
  }

  // ---- discard / leave guards ----
  function confirmDiscardIfDirty(): boolean {
    if (!dirty) return true;
    return window.confirm("יש שינויים שלא נשמרו. אם תמשיך/י, כל השינויים יימחקו. להמשיך?");
  }

  function leaveToAdmin() {
    if (dirty) {
      if (!window.confirm("יש שינויים שלא נשמרו. אם תעזוב/י את הדף, כל השינויים יימחקו. לעזוב בכל זאת?")) return;
    } else if (savedPendingExpose) {
      if (!window.confirm('השינויים נשמרו אך טרם נחשפו למשתמשים. אם לא תלחצ/י "חשוף שינויים למשתמשים", המשתמשים יראו אותם רק ממחר. לעזוב בכל זאת?')) return;
    }
    router.push("/admin");
  }

  // ---- model selector ----
  function selectModel(m: "auto" | "period") {
    if (m === model) return;
    if (!confirmDiscardIfDirty()) return;
    setModel(m); setMsg(""); setPending(null); setDirty(false);
    if (m === "auto") {
      if (serverModel === "auto") loadCourt(court!);   // reload the renew schedule
      else { seedEmptyGrid(); setStartDate(today); setEndDate(RENEW_END); setOrigStart(null); setOrigEnd(null); setReadOnly(false); }
    } else {
      // period: show the list (periods already loaded if server model was period, else empty)
      if (serverModel === "period") setPeriodView("list");
      else { setPeriods([]); setPeriodView("list"); }
    }
  }

  // ---- period actions ----
  function newPeriod() {
    if (!confirmDiscardIfDirty()) return;
    seedEmptyGrid(); setStartDate(""); setEndDate(""); setOrigStart(null); setOrigEnd(null); setReadOnly(false);
    setMsg(""); setPeriodView("editor");
  }

  async function newFromLast() {
    if (!periods.length) return;
    if (!confirmDiscardIfDirty()) return;
    const last = [...periods].sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
    setMsg("");
    try {
      const r = await api.get(`/admin/schedule/matrix?court_number=${court}&start=${last.start_date}&end=${last.end_date}`);
      loadGrid(r.data.cells, r.data.price_mode, r.data.hour_from, r.data.hour_to);
      setStartDate(""); setEndDate(""); setOrigStart(null); setOrigEnd(null); setReadOnly(false);
      setDirty(false); setPeriodView("editor");
    } catch (e: any) { setMsgOk(false); setMsg(problemText(e, "טעינת התקופה נכשלה")); }
  }

  async function editPeriod(p: Period) {
    if (!confirmDiscardIfDirty()) return;
    setMsg("");
    try {
      const r = await api.get(`/admin/schedule/matrix?court_number=${court}&start=${p.start_date}&end=${p.end_date}`);
      loadGrid(r.data.cells, r.data.price_mode, r.data.hour_from, r.data.hour_to);
      setStartDate(p.start_date); setEndDate(p.end_date);
      setOrigStart(p.start_date); setOrigEnd(p.end_date);
      setReadOnly(!p.editable);
      setDirty(false); setPeriodView("editor");
    } catch (e: any) { setMsgOk(false); setMsg(problemText(e, "טעינת התקופה נכשלה")); }
  }

  function askDeletePeriod(p: Period) {
    if (!window.confirm(`למחוק את התקופה ${p.start_date} – ${p.end_date}?`)) return;
    deletePeriod(p);
  }

  async function purgeOld() {
    if (court == null) return;
    if (!window.confirm("למחוק את כל התקופות שהסתיימו לפני יותר מ-30 יום? פעולה זו אינה הפיכה.")) return;
    setSaving(true); setMsg("");
    try {
      const r = await api.post("/admin/schedule/periods/purge-old", { court_number: court });
      setMsgOk(true); setMsg(r.data.message || "התקופות הישנות נמחקו.");
      await loadCourt(court);
    } catch (e: any) { setMsgOk(false); setMsg(problemText(e, "מחיקת תקופות ישנות נכשלה")); }
    finally { setSaving(false); }
  }

  async function deletePeriod(p: Period, confirm = false) {
    setSaving(true); setMsg("");
    try {
      const r = await api.delete("/admin/schedule/period", {
        data: { court_number: court, start_date: p.start_date, end_date: p.end_date, confirm_block_conflicts: confirm },
      });
      setPending(null); setMsgOk(true); setMsg(r.data.message);
      await loadCourt(court!);
    } catch (e: any) {
      const detail = e.response?.data?.detail;
      if (e.response?.status === 409 && detail?.conflicts) setPending({ type: "delete", period: p, conflicts: detail.conflicts });
      else { setMsgOk(false); setMsg(problemText(e, "מחיקת התקופה נכשלה")); }
    } finally { setSaving(false); }
  }

  // ---- grid editing ----
  function applyBrush(day: number, hour: number) {
    if (readOnly) return;
    setDirty(true);
    const key = `${day}-${hour}`;
    setGrid(prev => {
      const n = { ...prev };
      const existing = n[key];
      if (brush.kind === "block") delete n[key];
      else if (brush.kind === "tier") n[key] = { tier: brush.id, offset: existing ? existing.offset : 0 };
      else if (existing) n[key] = { ...existing, offset: brush.value };
      return n;
    });
  }
  function addTier() {
    const color = PALETTE[(nextTierId.current - 1) % PALETTE.length];
    const last = tiers[tiers.length - 1];
    const t: Tier = { id: nextTierId.current, color, member: last ? last.member : 0, nonMember: last ? last.nonMember : 0 };
    nextTierId.current++;
    setTiers(p => [...p, t]); setBrush({ kind: "tier", id: t.id }); setDirty(true);
  }
  function updateTier(id: number, field: "member" | "nonMember", val: number) {
    setTiers(p => p.map(t => t.id !== id ? t : (priceMode === "same" ? { ...t, member: val, nonMember: val } : { ...t, [field]: val })));
    setDirty(true);
  }
  function removeTier(id: number) {
    setTiers(p => p.filter(t => t.id !== id));
    setGrid(prev => { const n: Record<string, Cell> = {}; for (const k in prev) if (prev[k].tier !== id) n[k] = prev[k]; return n; });
    if (brush.kind === "tier" && brush.id === id) setBrush({ kind: "block" });
    setDirty(true);
  }
  function changeMode(m: "same" | "different") {
    setPriceMode(m);
    if (m === "same") setTiers(p => p.map(t => ({ ...t, nonMember: t.member })));
    setDirty(true);
  }

  function problemText(e: any, fallback: string): string {
    const detail = e?.response?.data?.detail;
    if (detail && typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && detail.message) return detail.message;
    if (e?.response?.status) return `${fallback} (קוד שגיאה ${e.response.status})`;
    if (e?.message) return `${fallback}: ${e.message}`;
    return fallback;
  }

  function buildCells() {
    const byId = new Map(tiers.map(t => [t.id, t]));
    const cells: any[] = [];
    for (const key in grid) {
      const c = grid[key]; const t = byId.get(c.tier); if (!t) continue;
      const [day, hour] = key.split("-").map(Number);
      cells.push({ day, hour, member_price: t.member, non_member_price: t.nonMember, minutes_offset: c.offset });
    }
    return cells;
  }

  async function doSave(confirm = false) {
    if (court == null) return;
    if (model === "period" && (!startDate || !endDate)) { setMsgOk(false); setMsg("יש להזין תאריך התחלה וסיום לתקופה"); return; }
    setSaving(true); setMsg("");
    const payload: any = {
      court_number: court, model, price_mode: priceMode,
      surface_type: surfaceType || null,
      cells: buildCells(), confirm_block_conflicts: confirm,
    };
    if (model === "auto") { payload.start_date = today; payload.end_date = RENEW_END; }
    else {
      payload.start_date = startDate; payload.end_date = endDate;
      if (origStart && origEnd) { payload.orig_start = origStart; payload.orig_end = origEnd; }
    }
    try {
      const r = await api.post("/admin/schedule/matrix", payload);
      setPending(null); setMsgOk(true);
      await loadCourt(court);   // refresh view (resets dirty & savedPendingExpose)...
      setDirty(false);
      setSavedPendingExpose(true);   // ...now armed: changes saved, expose enabled
      setMsg('לוח הזמנים נשמר. לחצו "חשוף שינויים למשתמשים" כדי שהמשתמשים יראו אותם עוד היום.');
    } catch (e: any) {
      const detail = e.response?.data?.detail;
      if (e.response?.status === 409 && detail?.conflicts) setPending({ type: "save", conflicts: detail.conflicts });
      else { setMsgOk(false); setMsg(problemText(e, "שמירת השינויים נכשלה")); }
    } finally { setSaving(false); }
  }

  async function rebuildClub() {
    setRebuilding(true); setMsg("");
    try {
      const r = await api.post("/admin/schedule/rebuild");
      setSavedPendingExpose(false);   // changes are now live for users
      setMsgOk(true); setMsg(r.data.message || "השינויים נחשפו למשתמשים.");
    } catch (e: any) { setMsgOk(false); setMsg(problemText(e, "חשיפת השינויים נכשלה")); }
    finally { setRebuilding(false); }
  }

  function confirmPending() {
    if (!pending) return;
    if (pending.type === "save") doSave(true);
    else if (pending.type === "delete" && pending.period) deletePeriod(pending.period, true);
  }

  const hours: number[] = [];
  for (let h = hourFrom; h <= hourTo; h++) hours.push(h);
  function cellColor(day: number, hour: number) {
    const c = grid[`${day}-${hour}`]; if (!c) return "#f3f4f6";
    return tiers.find(t => t.id === c.tier)?.color ?? "#f3f4f6";
  }
  function cellOffset(day: number, hour: number) { return grid[`${day}-${hour}`]?.offset ?? 0; }

  const showEditor = model === "auto" || (model === "period" && periodView === "editor");
  const editingExisting = model === "period" && !!origStart;

  // Periods list: newest-first, paginated 10 at a time.
  const sortedPeriods = [...periods].sort((a, b) => b.start_date.localeCompare(a.start_date));
  const totalPages = Math.max(1, Math.ceil(sortedPeriods.length / PERIODS_PER_PAGE));
  const page = Math.min(periodPage, totalPages - 1);
  const pageItems = sortedPeriods.slice(page * PERIODS_PER_PAGE, page * PERIODS_PER_PAGE + PERIODS_PER_PAGE);
  const oldCutoff = new Date(); oldCutoff.setDate(oldCutoff.getDate() - 30);
  const hasOldPeriods = periods.some(p => new Date(p.end_date) < oldCutoff);

  return (
    <main className="min-h-screen bg-canvas p-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-ink">עריכת לוח זמנים — {clubName}</h1>
          <button onClick={leaveToAdmin} className="text-sm text-court hover:underline">חזרה לניהול</button>
        </div>

        {/* Club-wide action: exposing rebuilds availability for ALL courts of the club. */}
        <div className="bg-white rounded-xl shadow p-4 mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-ink">חשיפת שינויים למשתמשים</p>
            <p className="text-xs text-muted">
              {savedPendingExpose && !rebuilding
                ? "השינויים נשמרו — יופיעו למשתמשים לאחר החשיפה (או אוטומטית מחר)."
                : "העדכון חל על כל המגרשים במועדון."}
            </p>
          </div>
          <button onClick={rebuildClub} disabled={!savedPendingExpose || rebuilding || saving || loading}
            title={!savedPendingExpose ? 'זמין רק לאחר לחיצה על "שמור שינויים"' : ""}
            className="border-2 border-court text-court px-6 py-3 rounded-lg hover:bg-mint transition disabled:opacity-40 disabled:cursor-not-allowed font-semibold whitespace-nowrap">
            {rebuilding ? "חושף שינויים..." : "חשוף שינויים למשתמשים"}
          </button>
        </div>

        {/* Status banner (last Save / Expose / period action result) */}
        {msg && (
          <div className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium flex items-start gap-2 ${msgOk ? "bg-mint text-court-dark border border-court/30" : "bg-red-50 text-red-700 border border-red-300"}`}>
            <span className="text-lg leading-none">{msgOk ? "✓" : "⚠"}</span><span>{msg}</span>
          </div>
        )}

        {/* Court + model selector */}
        <div className="bg-white rounded-xl shadow p-4 mb-4 flex flex-wrap gap-6 items-end">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">מגרש</label>
            <select value={court ?? ""} onChange={e => { const c = Number(e.target.value); if (confirmDiscardIfDirty()) setCourt(c); }}
              className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court">
              {courts.map(c => <option key={c.court_number} value={c.court_number}>מגרש {c.court_number}</option>)}
            </select>
          </div>
          <div>
            <span className="block text-sm font-medium text-ink mb-1">מודל לוח זמנים</span>
            <div className="flex gap-4 text-sm py-2">
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" checked={model === "auto"} onChange={() => selectModel("auto")} /> קבוע
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" checked={model === "period"} onChange={() => selectModel("period")} /> משתנה לפי תקופה
              </label>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">סוג משטח</label>
            <select value={surfaceType} onChange={e => { setSurfaceType(e.target.value); setDirty(true); }}
              className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court">
              <option value="">— לא מוגדר —</option>
              {SURFACES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {model === "auto" && (
            <p className="text-xs text-muted">לוח קבוע ללא תאריך סיום.</p>
          )}
        </div>

        {loading && <p className="text-center text-muted">טוען...</p>}

        {/* ---------- PERIOD LIST ---------- */}
        {!loading && model === "period" && periodView === "list" && (
          <div className="bg-white rounded-xl shadow p-4 mb-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="font-semibold text-ink">תקופות — מגרש {court}</h2>
              <div className="flex gap-2 flex-wrap">
                <button onClick={newPeriod} className="bg-court text-white px-4 py-2 rounded-lg hover:bg-court-dark text-sm font-semibold">תקופה חדשה</button>
                <button onClick={newFromLast} disabled={!periods.length}
                  className="border-2 border-court text-court px-4 py-2 rounded-lg hover:bg-mint text-sm font-semibold disabled:opacity-40">
                  תקופה חדשה מבוסס על האחרונה
                </button>
                <button onClick={purgeOld} disabled={!hasOldPeriods || saving}
                  title={!hasOldPeriods ? "אין תקופות שהסתיימו לפני יותר מ-30 יום" : ""}
                  className="border-2 border-red-400 text-red-600 px-4 py-2 rounded-lg hover:bg-red-50 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
                  מחק תקופות ישנות
                </button>
              </div>
            </div>
            {periods.length === 0 ? (
              <p className="text-muted text-sm">לא הוגדרו תקופות למגרש זה. לחצו "תקופה חדשה" כדי להתחיל.</p>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead className="text-muted border-b">
                    <tr><th className="text-right py-2">מתאריך</th><th className="text-right py-2">עד תאריך</th><th className="text-right py-2">סטטוס</th><th className="py-2"></th></tr>
                  </thead>
                  <tbody>
                    {pageItems.map((p, i) => (
                      <tr key={`${p.start_date}-${p.end_date}-${i}`} className="border-b last:border-0">
                        <td className="py-2">{p.start_date}</td>
                        <td className="py-2">{p.end_date}</td>
                        <td className="py-2"><span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${STATUS_CLS[p.status]}`}>{STATUS_LABEL[p.status]}</span></td>
                        <td className="py-2 text-left">
                          <button onClick={() => editPeriod(p)} className="text-court hover:underline ml-3">{p.editable ? "ערוך" : "צפייה"}</button>
                          <button onClick={() => askDeletePeriod(p)} className="text-red-600 hover:underline">מחק</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-4 mt-4 text-sm">
                    <button onClick={() => setPeriodPage(p => Math.max(0, p - 1))} disabled={page === 0}
                      className="px-3 py-1 rounded-lg border border-line hover:bg-canvas disabled:opacity-40 disabled:cursor-not-allowed">‹ הקודם</button>
                    <span className="text-muted">עמוד {page + 1} מתוך {totalPages}</span>
                    <button onClick={() => setPeriodPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                      className="px-3 py-1 rounded-lg border border-line hover:bg-canvas disabled:opacity-40 disabled:cursor-not-allowed">הבא ›</button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ---------- EDITOR (auto, or a period being edited/created) ---------- */}
        {!loading && showEditor && (
          <>
            {model === "period" && (
              <div className="bg-white rounded-xl shadow p-4 mb-4 flex flex-wrap gap-4 items-end">
                <button onClick={() => { if (confirmDiscardIfDirty()) { setPeriodView("list"); setMsg(""); } }} className="text-sm text-court hover:underline">← חזרה לרשימת התקופות</button>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">מתאריך</label>
                  <input type="date" value={startDate} disabled={editingExisting || readOnly}
                    onChange={e => { setStartDate(e.target.value); setDirty(true); }}
                    className="border rounded-lg px-3 py-2 disabled:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-court" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">עד תאריך</label>
                  <input type="date" value={endDate} disabled={readOnly}
                    onChange={e => { setEndDate(e.target.value); setDirty(true); }}
                    className="border rounded-lg px-3 py-2 disabled:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-court" />
                </div>
                {editingExisting && <p className="text-xs text-muted">עריכת תקופה קיימת — ניתן לשנות את תאריך הסיום בלבד.</p>}
                {readOnly && <p className="text-xs text-amber-700 font-semibold">תקופה שהסתיימה — צפייה בלבד.</p>}
              </div>
            )}

            {/* Palette / brushes */}
            {!readOnly && (
              <div className="bg-white rounded-xl shadow p-4 mb-4">
                <p className="text-sm mb-3">
                  כלי פעיל:{" "}
                  <span className="font-bold text-ink">
                    {brush.kind === "tier" ? "צביעת מחיר (צבע)" : brush.kind === "offset" ? `סימון היסט ${brush.value === 0 ? "00" : ":" + brush.value}` : "חסימה / מחיקה"}
                  </span>
                  <span className="text-muted"> — לחץ או גרור על התאים</span>
                </p>
                <div className="mb-3 flex gap-3 text-sm">
                  <label className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={priceMode === "same"} onChange={() => changeMode("same")} /> מחיר אחיד</label>
                  <label className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={priceMode === "different"} onChange={() => changeMode("different")} /> חבר / לא-חבר</label>
                </div>
                <div className={`flex flex-wrap gap-3 items-center rounded-lg p-2 ${brush.kind === "tier" ? "bg-canvas ring-1 ring-line" : ""}`}>
                  <span className="text-xs font-semibold text-muted">מחיר (צבע):</span>
                  {tiers.map(t => (
                    <div key={t.id} className={`flex items-center gap-2 border rounded-lg p-2 ${brush.kind === "tier" && brush.id === t.id ? "ring-2 ring-offset-1 ring-ink" : ""}`}>
                      <button type="button" onClick={() => setBrush({ kind: "tier", id: t.id })} className="w-6 h-6 rounded" style={{ background: t.color }} title="בחר צבע זה" />
                      {priceMode === "same" ? (
                        <span className="flex items-center gap-1 text-sm">₪<input type="number" value={t.member} onChange={e => updateTier(t.id, "member", Number(e.target.value))} className="w-16 border rounded px-1 py-0.5" /></span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs">
                          חבר ₪<input type="number" value={t.member} onChange={e => updateTier(t.id, "member", Number(e.target.value))} className="w-14 border rounded px-1 py-0.5" />
                          לא-חבר ₪<input type="number" value={t.nonMember} onChange={e => updateTier(t.id, "nonMember", Number(e.target.value))} className="w-14 border rounded px-1 py-0.5" />
                        </span>
                      )}
                      <button type="button" onClick={() => removeTier(t.id)} className="text-red-500 hover:text-red-700 text-lg leading-none" title="מחק מחיר">×</button>
                    </div>
                  ))}
                  <button type="button" onClick={addTier} className="border border-dashed rounded-lg px-3 py-2 text-sm text-court hover:bg-mint">+ הוסף מחיר</button>
                  <button type="button" onClick={() => setBrush({ kind: "block" })}
                    className={`border rounded-lg px-3 py-2 text-sm ${brush.kind === "block" ? "ring-2 ring-offset-1 ring-ink bg-mint" : ""}`} title="סמן תאים לחסימה">
                    <span className="inline-block w-4 h-4 rounded align-middle mr-1" style={{ background: "#f3f4f6", border: "1px solid #d1d5db" }} /> חסום / מחק
                  </button>
                </div>
                <div className={`mt-3 flex flex-wrap items-center gap-3 text-sm rounded-lg p-2 ${brush.kind === "offset" ? "bg-canvas ring-1 ring-line" : ""}`}>
                  <span className="font-medium text-ink">היסט התחלה (דקות אחרי השעה):</span>
                  {OFFSETS.map(o => (
                    <label key={o} className="flex items-center gap-1 cursor-pointer">
                      <input type="radio" name="offset" checked={brush.kind === "offset" && brush.value === o} onChange={() => setBrush({ kind: "offset", value: o })} />
                      {o === 0 ? "00 (ללא סימון)" : `:${o}`}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Matrix */}
            <div className="bg-white rounded-xl shadow p-4 overflow-x-auto">
              <table className="border-collapse select-none mx-auto" onDragStart={e => e.preventDefault()}>
                <thead>
                  <tr>
                    <th className="p-2 text-xs text-muted sticky right-0 bg-white">שעה</th>
                    {DAYS.map(d => <th key={d} className="p-2 text-xs font-medium text-ink" style={{ minWidth: 64 }}>{DAY_LABELS[d]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {hours.map(h => (
                    <tr key={h}>
                      <td className="p-1 text-xs text-muted text-center sticky right-0 bg-white">{String(h).padStart(2, "0")}:00</td>
                      {DAYS.map(d => (
                        <td key={d} style={{ padding: 0 }}>
                          <div
                            onMouseDown={() => { if (!readOnly) { painting.current = true; applyBrush(d, h); } }}
                            onMouseEnter={() => { if (painting.current) applyBrush(d, h); }}
                            className={readOnly ? "" : "cursor-pointer hover:opacity-80"}
                            style={{ height: 28, minWidth: 60, background: cellColor(d, h), border: "1px solid #fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff" }}
                            title={`${DAY_LABELS[d]} ${String(h).padStart(2, "0")}:${String(cellOffset(d, h)).padStart(2, "0")}`}>
                            {grid[`${d}-${h}`] && cellOffset(d, h) > 0 ? cellOffset(d, h) : ""}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Save is court-level (persists the current court's schedule). */}
        {showEditor && !readOnly && (
          <div className="mt-4 flex justify-end">
            <button onClick={() => doSave(false)} disabled={saving || rebuilding || loading}
              className="bg-court text-white px-8 py-3 rounded-lg hover:bg-court-dark transition disabled:opacity-50 font-semibold">
              {saving ? "שומר..." : "שמור שינויים"}
            </button>
          </div>
        )}
      </div>

      {/* Block-conflict confirmation modal */}
      {pending && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-bold text-ink mb-2">⚠ קיימות הזמנות עתידיות</h3>
            <p className="text-sm text-muted mb-3">
              {pending.type === "delete"
                ? "מחיקת התקופה תסיר זמינות במשבצות שכבר הוזמנו:"
                : "השינוי חוסם משבצות שכבר קיימות בהן הזמנות עתידיות:"}
            </p>
            <div className="max-h-56 overflow-y-auto border rounded-lg mb-3">
              <table className="w-full text-sm">
                <thead className="bg-mint text-court-dark"><tr><th className="text-right px-3 py-2">תאריך</th><th className="text-right px-3 py-2">שעה</th><th className="text-right px-3 py-2">לקוח</th><th className="text-right px-3 py-2">הזמנה</th></tr></thead>
                <tbody>
                  {pending.conflicts.map((c, i) => (
                    <tr key={i} className="border-t"><td className="px-3 py-2">{c.date}</td><td className="px-3 py-2">{String(c.hour).padStart(2, "0")}:00</td><td className="px-3 py-2">{c.customer}</td><td className="px-3 py-2">#{c.order_id}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted mb-4">ההזמנות הקיימות יישמרו ולא יבוטלו. המשבצות פשוט לא יוצעו יותר להזמנה עתידית.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setPending(null)} className="px-5 py-2 rounded-lg border border-line hover:bg-canvas text-sm">ביטול</button>
              <button onClick={confirmPending} disabled={saving} className="px-5 py-2 rounded-lg bg-court text-white hover:bg-court-dark text-sm font-semibold disabled:opacity-50">המשך בכל זאת</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
