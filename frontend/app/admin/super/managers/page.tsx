"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";

type Club = { id: number; club_name: string };
type Manager = { id: number; user_id: number; user_name: string; email: string; phone: string };

export default function SuperManagersPage() {
  const router = useRouter();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [club, setClub] = useState<number | null>(null);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [emailOrPhone, setEmailOrPhone] = useState("");
  const [msg, setMsg] = useState(""); const [msgOk, setMsgOk] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/users/me").then(r => {
      if (!r.data.is_super_admin) { router.push("/search"); return; }
      api.get("/admin/super/clubs").then(c => {
        setClubs(c.data);
        if (c.data.length) setClub(c.data[0].id);
      }).catch(() => {});
    }).catch(() => router.push("/login"));
  }, []);

  useEffect(() => { if (club) loadManagers(); }, [club]);

  function loadManagers() {
    if (!club) return;
    api.get(`/admin/super/clubs/${club}/managers`).then(r => setManagers(r.data)).catch(() => {});
  }

  async function addManager(e: React.FormEvent) {
    e.preventDefault();
    if (!club) return;
    setSaving(true); setMsg("");
    try {
      const r = await api.post(`/admin/super/clubs/${club}/managers`, { email_or_phone: emailOrPhone });
      setMsgOk(true); setMsg(r.data.message || "המנהל נוסף");
      setEmailOrPhone(""); loadManagers();
    } catch (e: any) {
      setMsgOk(false); setMsg(e.response?.data?.detail || "שגיאה בהוספת מנהל");
    } finally { setSaving(false); }
  }

  async function removeManager(id: number) {
    if (!window.confirm("להסיר את המנהל מהמועדון?")) return;
    try {
      await api.delete(`/admin/super/managers/${id}`);
      setManagers(m => m.filter(x => x.id !== id));
    } catch (e: any) { setMsgOk(false); setMsg(e.response?.data?.detail || "שגיאה בהסרה"); }
  }

  return (
    <main className="min-h-screen bg-canvas p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-ink">ניהול על — מנהלי מועדון</h1>
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

        {club && (
          <>
            <div className="bg-white rounded-xl shadow p-4 mb-4">
              <h2 className="font-semibold text-ink mb-3">הוספת מנהל</h2>
              <form onSubmit={addManager} className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[220px]">
                  <label className="block text-sm font-medium text-ink mb-1">אימייל או טלפון</label>
                  <input value={emailOrPhone} required onChange={e => setEmailOrPhone(e.target.value)}
                    placeholder="example@mail.com או 0501234567"
                    className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
                </div>
                <button type="submit" disabled={saving}
                  className="bg-court text-white px-6 py-2 rounded-lg hover:bg-court-dark disabled:opacity-50 text-sm font-semibold">
                  {saving ? "מוסיף..." : "מנה כמנהל"}
                </button>
              </form>
              <p className="text-xs text-muted mt-2">הוספת מנהל מעניקה למשתמש הרשאת ניהול (ROLE_ADMIN) עבור המועדון הזה.</p>
            </div>

            <div className="bg-white rounded-xl shadow p-4">
              <h2 className="font-semibold text-ink mb-3">מנהלי המועדון ({managers.length})</h2>
              {managers.length === 0 ? (
                <p className="text-sm text-muted">אין מנהלים למועדון זה.</p>
              ) : (
                <div className="space-y-2">
                  {managers.map(m => (
                    <div key={m.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="text-sm font-medium">{m.user_name}</p>
                        <p className="text-xs text-muted">{m.email} | {m.phone || "—"}</p>
                      </div>
                      <button onClick={() => removeManager(m.id)}
                        className="bg-red-500 text-white px-3 py-1 rounded text-xs hover:bg-red-600">הסר</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
