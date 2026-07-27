"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";

type Area = { id: number; description: string };
type Club = { id: number; club_name: string };

export default function HeroSearch() {
  const router = useRouter();
  const today = new Date().toISOString().split("T")[0];
  const [areas, setAreas] = useState<Area[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [areaId, setAreaId] = useState("");
  const [clubId, setClubId] = useState("");
  const [date, setDate] = useState(today);
  const [fromHour, setFromHour] = useState("17");
  const [toHour, setToHour] = useState("22");

  useEffect(() => {
    api.get("/clubs/areas").then(r => setAreas(r.data)).catch(() => {});
  }, []);

  // clubs depend on the selected area
  useEffect(() => {
    const url = areaId ? `/clubs?area_id=${areaId}` : "/clubs";
    api.get(url).then(r => setClubs(r.data)).catch(() => setClubs([]));
    setClubId("");
  }, [areaId]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams();
    p.set("from_date", date || today);
    p.set("from_hour", fromHour);
    p.set("to_hour", toHour);
    if (areaId) p.set("area_id", areaId);
    if (clubId) p.set("club_id", clubId);
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
        <select className={ctrl} value={areaId} onChange={e => setAreaId(e.target.value)}>
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
