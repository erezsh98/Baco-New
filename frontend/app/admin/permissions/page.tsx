"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";

type Club = { id: number; club_name: string };
type Group = { id: number; name: string; ticket_type: string };
type Permit = {
  id: number; user_id: number; user_name: string;
  email: string; phone: string; group: string; end_date: string | null;
};

export default function PermissionsPage() {
  const router = useRouter();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [selectedClub, setSelectedClub] = useState<number | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [permits, setPermits] = useState<Permit[]>([]);

  const [form, setForm] = useState({ email_or_phone: "", group_id: "", end_date: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    // Only clubs this manager manages (was /clubs = all clubs). Default to the
    // active club so it stays in sync with the navbar club switcher.
    api.get("/admin/my-clubs").then(r => {
      const cs: Club[] = r.data || [];
      setClubs(cs);
      if (cs.length === 0) return;
      const stored = localStorage.getItem("active_club_id");
      const valid = stored && cs.some(c => String(c.id) === stored);
      setSelectedClub(valid ? Number(stored) : cs[0].id);
    }).catch(() => router.push("/search"));
  }, []);

  useEffect(() => {
    if (selectedClub) {
      api.get(`/admin/clubs/${selectedClub}/groups`).then(r => setGroups(r.data)).catch(() => setGroups([]));
      loadPermits();
    }
  }, [selectedClub]);

  function loadPermits() {
    if (!selectedClub) return;
    api.get(`/admin/clubs/${selectedClub}/users`).then(r => setPermits(r.data)).catch(() => {});
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!selectedClub) return;
    setLoading(true);
    try {
      const res = await api.post(`/admin/clubs/${selectedClub}/users`, {
        email_or_phone: form.email_or_phone,
        group_id: Number(form.group_id),
        end_date: form.end_date,
      });
      setSuccess(res.data.message || "המשתמש צורף בהצלחה");
      setForm({ email_or_phone: "", group_id: "", end_date: "" });
      loadPermits();
    } catch (e: any) {
      setError(e.response?.data?.detail || "שגיאה בהוספת המשתמש");
    } finally {
      setLoading(false);
    }
  }

  async function removePermit(id: number) {
    try {
      await api.delete(`/admin/permissions/${id}`);
      setPermits(p => p.filter(x => x.id !== id));
    } catch {
      setError("שגיאה בהסרה");
    }
  }

  return (
    <main className="min-h-screen bg-canvas p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-ink">
            ניהול הרשאות מועדון{clubs.find(c => c.id === selectedClub)?.club_name ? ` - ${clubs.find(c => c.id === selectedClub)!.club_name}` : ""}
          </h1>
          <Link href="/admin" className="text-sm text-court hover:underline">ניהול הזמנות</Link>
        </div>

        {selectedClub && (
          <>
            <div className="bg-white rounded-xl shadow p-4 mb-4">
              <h2 className="font-semibold text-ink mb-3">הוספת משתמש לקבוצה</h2>
              <form onSubmit={addUser} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">אימייל או טלפון</label>
                  <input value={form.email_or_phone} required
                    onChange={e => setForm({ ...form, email_or_phone: e.target.value })}
                    placeholder="example@mail.com או 0501234567"
                    className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">קבוצה</label>
                  <select value={form.group_id} required
                    onChange={e => setForm({ ...form, group_id: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court">
                    <option value="">בחר קבוצה...</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">תאריך סיום</label>
                  <input type="date" value={form.end_date} required
                    onChange={e => setForm({ ...form, end_date: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
                </div>

                {error && <p className="text-red-600 text-sm">{error}</p>}
                {success && <p className="text-court text-sm">{success}</p>}

                <button type="submit" disabled={loading}
                  className="bg-court text-white px-6 py-2 rounded-lg hover:bg-court-dark disabled:opacity-50">
                  {loading ? "מוסיף..." : "צרף לקבוצה"}
                </button>
              </form>
            </div>

            <div className="bg-white rounded-xl shadow p-4">
              <h2 className="font-semibold text-ink mb-3">משתמשים מורשים ({permits.length})</h2>
              {permits.length === 0 && <p className="text-sm text-muted">אין משתמשים מורשים</p>}
              <div className="space-y-2">
                {permits.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="text-sm font-medium">{p.user_name}</p>
                      <p className="text-xs text-muted">{p.email} | {p.phone}</p>
                      <p className="text-xs text-court">קבוצה: {p.group} | בתוקף עד: {p.end_date || "—"}</p>
                    </div>
                    <button onClick={() => removePermit(p.id)}
                      className="bg-red-500 text-white px-3 py-1 rounded text-xs hover:bg-red-600">
                      הסר
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
