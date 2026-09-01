"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";

type Area = { id: number; description: string };
type Club = {
  id: number; club_name: string; area_id: number | null; area_name: string | null;
  email: string | null; num_of_courts: number | null; contact_name: string | null; contact_phone: string | null;
  min_hour_for_cancel: number | null; rent_threshold_days: number | null; rental_threshold_hours: number | null;
  admin_start_hour: number | null; slot_window_days: number | null; u_name: string | null;
  street: string | null; city: string | null;
};

const EMPTY: any = {
  club_name: "", area_id: "", email: "", num_of_courts: "", contact_name: "", contact_phone: "",
  min_hour_for_cancel: "", rent_threshold_days: "", rental_threshold_hours: "", admin_start_hour: "",
  slot_window_days: "", u_name: "", street: "", city: "",
};

export default function SuperClubsPage() {
  const router = useRouter();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [editId, setEditId] = useState<number | null>(null);   // null = not editing; 0 = new
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [msg, setMsg] = useState(""); const [msgOk, setMsgOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState<number | "all" | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.get("/users/me").then(r => {
      if (!r.data.is_super_admin) { router.push("/search"); return; }
      load(); api.get("/admin/super/areas").then(a => setAreas(a.data)).catch(() => {});
    }).catch(() => router.push("/login"));
  }, []);

  function load() { api.get("/admin/super/clubs").then(r => setClubs(r.data)).catch(() => {}); }

  function openNew() { setEditId(0); setForm({ ...EMPTY }); setMsg(""); }
  function openEdit(c: Club) {
    setEditId(c.id); setMsg("");
    setForm({
      club_name: c.club_name ?? "", area_id: c.area_id ?? "", email: c.email ?? "", num_of_courts: c.num_of_courts ?? "",
      contact_name: c.contact_name ?? "", contact_phone: c.contact_phone ?? "",
      min_hour_for_cancel: c.min_hour_for_cancel ?? "", rent_threshold_days: c.rent_threshold_days ?? "",
      rental_threshold_hours: c.rental_threshold_hours ?? "", admin_start_hour: c.admin_start_hour ?? "",
      slot_window_days: c.slot_window_days ?? "", u_name: c.u_name ?? "",
      street: c.street ?? "", city: c.city ?? "",
    });
  }

  function numOrNull(v: any) { return v === "" || v === null ? null : Number(v); }

  async function save() {
    setSaving(true); setMsg("");
    const payload = {
      club_name: form.club_name, area_id: numOrNull(form.area_id), email: form.email || null,
      num_of_courts: numOrNull(form.num_of_courts), contact_name: form.contact_name || null,
      contact_phone: form.contact_phone || null, min_hour_for_cancel: numOrNull(form.min_hour_for_cancel),
      rent_threshold_days: numOrNull(form.rent_threshold_days), rental_threshold_hours: numOrNull(form.rental_threshold_hours),
      admin_start_hour: numOrNull(form.admin_start_hour), slot_window_days: numOrNull(form.slot_window_days),
      u_name: form.u_name || null,
      street: form.street || null, city: form.city || null,
    };
    try {
      if (editId === 0) await api.post("/admin/super/clubs", payload);
      else await api.put(`/admin/super/clubs/${editId}`, payload);
      setMsgOk(true); setMsg("המועדון נשמר בהצלחה.");
      setEditId(null); load();
    } catch (e: any) {
      setMsgOk(false); setMsg(e.response?.data?.detail || "שגיאה בשמירה");
    } finally { setSaving(false); }
  }

  async function rebuild(clubId: number | null, label: string) {
    if (!window.confirm(`לעדכן את הזמינות עבור ${label}? הפעולה תבנה מחדש את המשבצות הפנויות.`)) return;
    setRebuilding(clubId === null ? "all" : clubId); setMsg("");
    try {
      const r = await api.post("/admin/super/rebuild", { club_id: clubId });
      setMsgOk(true); setMsg(r.data.message || "הזמינות עודכנה.");
    } catch (e: any) {
      setMsgOk(false); setMsg(e.response?.data?.detail || "שגיאה בעדכון הזמינות");
    } finally { setRebuilding(null); }
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? clubs.filter(c => [c.club_name, c.area_name, c.city, c.contact_name, c.contact_phone, c.u_name]
        .some(v => (v || "").toLowerCase().includes(q)))
    : clubs;

  const F = (label: string, name: string, type = "text") => (
    <div>
      <label className="block text-sm font-medium text-ink mb-1">{label}</label>
      <input type={type} value={form[name]} onChange={e => setForm({ ...form, [name]: e.target.value })}
        className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
    </div>
  );

  return (
    <main className="min-h-screen bg-canvas p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-ink">ניהול על — מועדונים</h1>
          <Link href="/" className="text-sm text-court hover:underline">דף הבית</Link>
        </div>

        {msg && <div className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${msgOk ? "bg-mint text-court-dark border border-court/30" : "bg-red-50 text-red-700 border border-red-300"}`}>{msg}</div>}

        {editId === null ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="חיפוש מועדון (שם, אזור, עיר, איש קשר)…"
                className="w-full sm:w-72 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-court" />
              <div className="flex gap-2">
                <button onClick={() => rebuild(null, "כל המועדונים")} disabled={rebuilding !== null}
                  className="border-2 border-court text-court px-4 py-2 rounded-lg hover:bg-mint text-sm font-semibold disabled:opacity-50">
                  {rebuilding === "all" ? "מעדכן..." : "עדכן זמינות לכל המועדונים"}
                </button>
                <button onClick={openNew} className="bg-court text-white px-4 py-2 rounded-lg hover:bg-court-dark text-sm font-semibold">מועדון חדש</button>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-ink text-white"><tr>
                  <th className="px-4 py-3 text-right">מועדון</th><th className="px-4 py-3 text-right">אזור</th>
                  <th className="px-4 py-3 text-right">מגרשים</th><th className="px-4 py-3 text-right">ביטול (שעות)</th>
                  <th className="px-4 py-3 text-right">חלון ימים</th><th className="px-4 py-3"></th>
                </tr></thead>
                <tbody>
                  {filtered.map((c, i) => (
                    <tr key={c.id} className={i % 2 === 0 ? "bg-white" : "bg-canvas"}>
                      <td className="px-4 py-3 font-medium">{c.club_name}</td>
                      <td className="px-4 py-3">{c.area_name || "—"}</td>
                      <td className="px-4 py-3">{c.num_of_courts ?? "—"}</td>
                      <td className="px-4 py-3">{c.min_hour_for_cancel ?? "—"}</td>
                      <td className="px-4 py-3">{c.slot_window_days ?? "30 (ברירת מחדל)"}</td>
                      <td className="px-4 py-3 text-left whitespace-nowrap">
                        <button onClick={() => openEdit(c)} className="text-court hover:underline ml-3">ערוך</button>
                        <button onClick={() => rebuild(c.id, c.club_name)} disabled={rebuilding !== null} className="text-court hover:underline disabled:opacity-50">
                          {rebuilding === c.id ? "מעדכן..." : "עדכן זמינות"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">
                      {clubs.length === 0 ? "אין מועדונים." : `לא נמצאו מועדונים התואמים ל"${query}".`}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="bg-white rounded-xl shadow p-4">
            <h2 className="font-semibold text-ink mb-4">{editId === 0 ? "מועדון חדש" : "עריכת מועדון"}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {F("שם מועדון", "club_name")}
              <div>
                <label className="block text-sm font-medium text-ink mb-1">אזור</label>
                <select value={form.area_id} onChange={e => setForm({ ...form, area_id: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court">
                  <option value="">— ללא —</option>
                  {areas.map(a => <option key={a.id} value={a.id}>{a.description}</option>)}
                </select>
              </div>
              {F("אימייל", "email")}
              {F("מספר מגרשים", "num_of_courts", "number")}
              {F("איש קשר", "contact_name")}
              {F("טלפון איש קשר", "contact_phone")}
              {F("שעות מינימום לביטול", "min_hour_for_cancel", "number")}
              {F("חלון ימים להזמנה (ריק = 30)", "slot_window_days", "number")}
              {F("סף ימים מראש", "rent_threshold_days", "number")}
              {F("סף שעות מראש", "rental_threshold_hours", "number")}
              {F("שעת התחלת ניהול", "admin_start_hour", "number")}
              {F("Pelecard u_name", "u_name")}
              {F("רחוב", "street")}
              {F("עיר", "city")}
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setEditId(null)} className="px-5 py-2 rounded-lg border border-line hover:bg-canvas text-sm">ביטול</button>
              <button onClick={save} disabled={saving || !form.club_name.trim()}
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
