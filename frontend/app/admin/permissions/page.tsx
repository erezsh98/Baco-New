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
  // Live preview of the user matched by the typed email/phone, so the manager
  // can confirm who they're granting a permission to before submitting.
  type MatchedUser = { user_name: string; email: string; phone: string };
  const [matched, setMatched] = useState<MatchedUser | null>(null);
  const [matchState, setMatchState] = useState<"idle" | "searching" | "notfound">("idle");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [view, setView] = useState<"add" | "report">("add");
  const [filterUser, setFilterUser] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const [editPermitId, setEditPermitId] = useState<number | null>(null);
  const [editDate, setEditDate] = useState("");
  const todayStr = new Date().toISOString().split("T")[0];

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

  // Debounced lookup of the typed email/phone → preview the matched user.
  useEffect(() => {
    const ident = form.email_or_phone.trim();
    if (ident.length < 3) { setMatched(null); setMatchState("idle"); return; }
    let active = true;
    setMatchState("searching");
    const t = setTimeout(() => {
      api.get(`/admin/users/lookup?ident=${encodeURIComponent(ident)}`)
        .then(r => { if (active) { setMatched(r.data); setMatchState("idle"); } })
        .catch(() => { if (active) { setMatched(null); setMatchState("notfound"); } });
    }, 400);
    return () => { active = false; clearTimeout(t); };
  }, [form.email_or_phone]);

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

  // A row is active (editable) when it has no end date or it hasn't passed yet.
  const isActive = (p: Permit) => !p.end_date || p.end_date >= todayStr;
  function startEditDate(p: Permit) { setEditPermitId(p.id); setEditDate(p.end_date || todayStr); setError(""); }
  async function saveEndDate(p: Permit) {
    if (!editDate) return;
    try {
      await api.patch(`/admin/permissions/${p.id}`, { end_date: editDate });
      setEditPermitId(null);
      loadPermits();
    } catch (e: any) {
      setError(e.response?.data?.detail || "עדכון התאריך נכשל");
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
            {/* action tabs */}
            <div className="flex gap-2 mb-4">
              <button onClick={() => { setView("add"); setError(""); }}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border-2 transition ${view === "add" ? "border-court bg-mint text-court-dark" : "border-line text-muted hover:bg-mint"}`}>
                הוספת משתמש לקבוצה
              </button>
              <button onClick={() => { setView("report"); setError(""); }}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border-2 transition ${view === "report" ? "border-court bg-mint text-court-dark" : "border-line text-muted hover:bg-mint"}`}>
                דוח הרשאות
              </button>
            </div>

            {view === "add" && (
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="font-semibold text-ink mb-3">הוספת משתמש לקבוצה</h2>
                <form onSubmit={addUser} className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">אימייל או טלפון</label>
                    <input value={form.email_or_phone} required
                      onChange={e => setForm({ ...form, email_or_phone: e.target.value })}
                      placeholder="example@mail.com או 0501234567"
                      className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
                    {/* Matched-user preview: confirm who gets the permission */}
                    {matchState === "searching" && (
                      <p className="text-xs text-muted mt-1">מחפש משתמש...</p>
                    )}
                    {matched && (
                      <div className="mt-2 flex items-center gap-2 rounded-lg bg-mint px-3 py-2 text-sm">
                        <span className="text-court">✓</span>
                        <span className="font-semibold text-court-dark">{matched.user_name || "—"}</span>
                        <span className="text-muted">·</span>
                        <span className="text-ink">{matched.email}</span>
                        {matched.phone && <><span className="text-muted">·</span><span className="text-ink">{matched.phone}</span></>}
                      </div>
                    )}
                    {matchState === "notfound" && (
                      <p className="text-xs text-red-600 mt-1">לא נמצא משתמש עם פרטים אלו</p>
                    )}
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
            )}

            {view === "report" && (() => {
              const groupNames = Array.from(new Set(permits.map(p => p.group).filter(Boolean))).sort();
              const u = filterUser.trim().toLowerCase();
              const shown = permits.filter(p => {
                const matchUser = !u || (p.email || "").toLowerCase().includes(u) || (p.phone || "").includes(filterUser.trim());
                const matchGroup = !filterGroup || p.group === filterGroup;
                return matchUser && matchGroup;
              });
              return (
                <div className="bg-white rounded-xl shadow p-4">
                  <h2 className="font-semibold text-ink mb-3">דוח הרשאות</h2>

                  {/* filters */}
                  <div className="flex flex-wrap gap-4 items-end mb-4">
                    <div className="flex-1 min-w-[200px]">
                      <label className="block text-sm font-medium text-ink mb-1">אימייל או טלפון</label>
                      <input value={filterUser} onChange={e => setFilterUser(e.target.value)}
                        placeholder="סינון לפי משתמש..."
                        className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
                    </div>
                    <div className="min-w-[160px]">
                      <label className="block text-sm font-medium text-ink mb-1">קבוצה</label>
                      <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court">
                        <option value="">כל הקבוצות</option>
                        {groupNames.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                    {(filterUser || filterGroup) && (
                      <button onClick={() => { setFilterUser(""); setFilterGroup(""); }}
                        className="text-sm text-court hover:underline pb-2">נקה סינון</button>
                    )}
                  </div>

                  {shown.length === 0 ? (
                    <p className="text-sm text-muted">לא נמצאו הרשאות{(filterUser || filterGroup) ? " התואמות לסינון" : ""}.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-muted border-b">
                          <tr>
                            <th className="text-right py-2 px-2">משתמש</th>
                            <th className="text-right py-2 px-2">אימייל</th>
                            <th className="text-right py-2 px-2">טלפון</th>
                            <th className="text-right py-2 px-2">קבוצה</th>
                            <th className="text-right py-2 px-2">בתוקף עד</th>
                            <th className="py-2 px-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map(p => (
                            <tr key={p.id} className="border-b last:border-0">
                              <td className="py-2 px-2 whitespace-nowrap">{p.user_name}</td>
                              <td className="py-2 px-2">{p.email}</td>
                              <td className="py-2 px-2 whitespace-nowrap">{p.phone || "—"}</td>
                              <td className="py-2 px-2 whitespace-nowrap">{p.group}</td>
                              <td className="py-2 px-2 whitespace-nowrap">
                                {editPermitId === p.id ? (
                                  <span className="flex items-center gap-1">
                                    <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                                      className="border rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-court" />
                                    <button onClick={() => saveEndDate(p)} className="text-court hover:underline">שמור</button>
                                    <button onClick={() => setEditPermitId(null)} className="text-muted hover:underline">ביטול</button>
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-2">
                                    {p.end_date || "—"}
                                    {isActive(p) && (
                                      <button onClick={() => startEditDate(p)} className="text-court hover:underline text-xs">ערוך</button>
                                    )}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-2 text-left">
                                <button onClick={() => removePermit(p.id)} className="text-red-600 hover:underline">הסר</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-xs text-muted mt-3">{shown.length} מתוך {permits.length} הרשאות</p>
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        )}
      </div>
    </main>
  );
}
