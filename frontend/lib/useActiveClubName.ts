"use client";
import { useState, useEffect } from "react";
import api from "@/lib/api";

/** The active club's name (from the club switcher / first managed club), or "". */
export function useActiveClubName(): string {
  const [name, setName] = useState("");
  useEffect(() => {
    api.get("/admin/my-clubs")
      .then(r => {
        const cs: { id: number; club_name: string }[] = r.data || [];
        if (cs.length === 0) return;
        const stored = localStorage.getItem("active_club_id");
        const c = cs.find(x => String(x.id) === stored) || cs[0];
        setName(c.club_name);
      })
      .catch(() => {});
  }, []);
  return name;
}
