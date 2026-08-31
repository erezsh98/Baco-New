"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";

type Area = { id: number; description: string };
type Club = { id: number; club_name: string };

export type SearchValues = {
  from_date: string;
  from_hour: string;
  to_hour: string;
  area_id: string;
  club_id: string;
};

/**
 * Shared court-search form (the "hero card"). Used on the home page and on the
 * /search results page so both look and behave identically.
 *  - No `onSearch`  → navigates to /search?<params> (home page).
 *  - With `onSearch` → calls it with the values (results page searches in place).
 * `initial` pre-fills the fields (date defaults to today when absent).
 */
export default function SearchForm({
  initial,
  onSearch,
}: {
  initial?: Partial<SearchValues>;
  onSearch?: (v: SearchValues) => void;
}) {
  const router = useRouter();
  const today = new Date().toISOString().split("T")[0];
  const [areas, setAreas] = useState<Area[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [areaId, setAreaId] = useState(initial?.area_id || "");
  const [clubId, setClubId] = useState(initial?.club_id || "");
  const [date, setDate] = useState(initial?.from_date || today);
  const [fromHour, setFromHour] = useState(initial?.from_hour || "6");
  const [toHour, setToHour] = useState(initial?.to_hour || "22");

  useEffect(() => {
    api.get("/clubs/areas").then(r => setAreas(r.data)).catch(() => {});
  }, []);

  // clubs depend on the selected area. NOTE: we do NOT clear clubId here — that
  // would wipe an initial (pre-filled) club on mount. The club is cleared only
  // when the user actively changes the area (in the <select> onChange).
  useEffect(() => {
    const url = areaId ? `/clubs?area_id=${areaId}` : "/clubs";
    api.get(url).then(r => setClubs(r.data)).catch(() => setClubs([]));
  }, [areaId]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const values: SearchValues = {
      from_date: date || today,
      from_hour: fromHour,
      to_hour: toHour,
      area_id: areaId,
      club_id: clubId,
    };
    if (onSearch) {
      onSearch(values);
      return;
    }
    const p = new URLSearchParams();
    p.set("from_date", values.from_date);
    p.set("from_hour", values.from_hour);
    p.set("to_hour", values.to_hour);
    if (values.area_id) p.set("area_id", values.area_id);
    if (values.club_id) p.set("club_id", values.club_id);
    router.push(`/search?${p.toString()}`);
  }

  const hours = Array.from({ length: 18 }, (_, i) => 6 + i); // 06:00–23:00
  const box = "rounded-xl border border-line bg-canvas px-3.5 py-2";
  const lab = "mb-0.5 block text-xs font-bold text-muted";
  const ctrl = "w-full bg-transparent text-[15px] font-bold text-ink focus:outline-none";

  return (
    <form onSubmit={submit}
      className="mx-auto grid max-w-3xl items-end gap-3 rounded-3xl border border-line bg-surface p-4 text-right shadow-float sm:grid-cols-2 lg:grid-cols-3">
      <label className={box}>
        <span className={lab}>אזור</span>
        <select className={ctrl} value={areaId} onChange={e => { setAreaId(e.target.value); setClubId(""); }}>
          <option value="">כל האזורים</option>
          {areas.map(a => <option key={a.id} value={a.id}>{a.description}</option>)}
        </select>
      </label>
      <label className={box}>
        <span className={lab}>מועדון</span>
        <select className={ctrl} value={clubId} onChange={e => setClubId(e.target.value)}>
          <option value="">כל המועדונים</option>
          {clubs.map(c => <option key={c.id} value={c.id}>{c.club_name}</option>)}
        </select>
      </label>
      <label className={box}>
        <span className={lab}>תאריך</span>
        <input type="date" min={today} className={ctrl} value={date} onChange={e => setDate(e.target.value)} />
      </label>
      <label className={box}>
        <span className={lab}>משעה</span>
        <select className={ctrl} value={fromHour} onChange={e => setFromHour(e.target.value)}>
          {hours.map(h => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
        </select>
      </label>
      <label className={box}>
        <span className={lab}>עד שעה</span>
        <select className={ctrl} value={toHour} onChange={e => setToHour(e.target.value)}>
          {hours.map(h => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
        </select>
      </label>
      <button type="submit"
        className="flex h-[52px] items-center justify-center gap-2 rounded-2xl bg-court px-7 text-base font-extrabold text-white transition-colors hover:bg-court-dark">
        חיפוש מגרש 🎾
      </button>
    </form>
  );
}
