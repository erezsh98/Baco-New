"use client";
import { useState, useEffect } from "react";
import api from "@/lib/api";

type Club = { id: number; club_name: string };

// Active-club selector for managers who manage more than one club. Stores the
// choice in localStorage("active_club_id"); the axios interceptor sends it as
// X-Club-Id so every admin request is scoped to the chosen club. Renders nothing
// for single-club managers (their one club is the default server-side).
export default function ClubSwitcher() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    api.get("/admin/my-clubs")
      .then(r => {
        const cs: Club[] = r.data || [];
        setClubs(cs);
        if (cs.length === 0) return;
        const stored = localStorage.getItem("active_club_id");
        const valid = stored && cs.some(c => String(c.id) === stored);
        const chosen = valid ? stored! : String(cs[0].id);
        localStorage.setItem("active_club_id", chosen);
        setActive(chosen);
      })
      .catch(() => {});
  }, []);

  if (clubs.length <= 1) return null;

  function change(id: string) {
    localStorage.setItem("active_club_id", id);
    setActive(id);
    window.location.reload();   // re-fetch every admin view with the new active club
  }

  return (
    <div className="px-3 sm:px-4 py-2 border-b border-line">
      <label className="block text-xs text-muted mb-1">מועדון פעיל</label>
      <select value={active} onChange={e => change(e.target.value)}
        className="w-full border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-court">
        {clubs.map(c => <option key={c.id} value={String(c.id)}>{c.club_name}</option>)}
      </select>
    </div>
  );
}
