"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import ChatWidget from "@/components/agent/ChatWidget";

type Area = { id: number; description: string };
type Club = { id: number; club_name: string };
type Slot = {
  id: number; club_name: string; club_id: number;
  court_number: number; surface_type: string;
  date: string; hour: number; minutes_offset: number;
  member_price: number; non_member_price: number;
  price: number; is_member_price: boolean; is_free: boolean;
};

export default function SearchPage() {
  const router = useRouter();
  const [areas, setAreas] = useState<Area[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [form, setForm] = useState({
    from_date: "", to_date: "", from_hour: "", to_hour: "", area_id: "", club_id: "",
  });
  const [slots, setSlots] = useState<Slot[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/clubs/areas").then(r => setAreas(r.data)).catch(() => {});
  }, []);

  // Prefill from URL query (e.g. arriving from the homepage hero search) and auto-search.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if ([...sp.keys()].length === 0) return;
    const initial = {
      from_date: sp.get("from_date") || "",
      to_date: sp.get("to_date") || sp.get("from_date") || "",
      from_hour: sp.get("from_hour") || "",
      to_hour: sp.get("to_hour") || "",
      area_id: sp.get("area_id") || "",
      club_id: sp.get("club_id") || "",
    };
    setForm(initial);
    if (initial.from_date) runSearch(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (form.area_id) {
      api.get(`/clubs?area_id=${form.area_id}`).then(r => setClubs(r.data)).catch(() => {});
    } else {
      api.get("/clubs").then(r => setClubs(r.data)).catch(() => {});
    }
  }, [form.area_id]);

  function handle(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function runSearch(f: typeof form) {
    setError(""); setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("from_date", f.from_date);
      params.set("to_date", f.to_date || f.from_date);
      if (f.from_hour) params.set("from_hour", f.from_hour);
      if (f.to_hour) params.set("to_hour", f.to_hour);
      if (f.area_id) params.set("area_id", f.area_id);
      if (f.club_id) params.set("club_id", f.club_id);
      const res = await api.get(`/courts/search?${params}`);
      setSlots(res.data);
      setSearched(true);
    } catch {
      setError("שגיאה בחיפוש. אנא נסה שוב.");
    } finally {
      setLoading(false);
    }
  }

  function search(e: React.FormEvent) {
    e.preventDefault();
    runSearch(form);
  }

  function book(slot: Slot) {
    // Save the chosen slot first so the reservation survives an auth detour.
    localStorage.setItem("selected_slot", JSON.stringify(slot));
    if (!localStorage.getItem("access_token")) {
      // Old flow: choosing a court redirects to the (secured) payment step, which
      // sends an unauthenticated user to the login screen, then continues the order.
      // The login page offers a register link (also carrying `next`).
      router.push("/login?next=/booking/payment");
      return;
    }
    router.push("/booking/payment");
  }

  const today = new Date().toISOString().split("T")[0];

  return (
    <main className="min-h-screen bg-mint p-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-court-dark mb-6 text-center">חיפוש מגרש פנוי</h1>

        <form onSubmit={search} className="bg-white rounded-2xl shadow p-6 mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-sm font-medium text-ink mb-1">תאריך</label>
            <input type="date" name="from_date" required min={today} value={form.from_date}
              onChange={handle} className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">שעה מ-</label>
            <input type="number" name="from_hour" min={6} max={22} placeholder="6"
              value={form.from_hour} onChange={handle}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">שעה עד-</label>
            <input type="number" name="to_hour" min={6} max={23} placeholder="22"
              value={form.to_hour} onChange={handle}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">אזור</label>
            <select name="area_id" value={form.area_id} onChange={handle}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court">
              <option value="">כל האזורים</option>
              {areas.map(a => <option key={a.id} value={a.id}>{a.description}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">מועדון</label>
            <select name="club_id" value={form.club_id} onChange={handle}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court">
              <option value="">כל המועדונים</option>
              {clubs.map(c => <option key={c.id} value={c.id}>{c.club_name}</option>)}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-3 flex justify-center">
            <button type="submit" disabled={loading}
              className="bg-court text-white px-8 py-2 rounded-lg hover:bg-court-dark transition disabled:opacity-50">
              {loading ? "מחפש..." : "חפש"}
            </button>
          </div>
        </form>

        {error && <p className="text-red-600 text-center mb-4">{error}</p>}

        {searched && slots.length === 0 && (
          <p className="text-center text-muted">לא נמצאו מגרשים פנויים לתאריך ושעה שנבחרו.</p>
        )}

        {slots.length > 0 && (
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-court text-white">
                <tr>
                  <th className="px-4 py-3 text-right">מועדון</th>
                  <th className="px-4 py-3 text-right">תאריך</th>
                  <th className="px-4 py-3 text-right">שעה</th>
                  <th className="px-4 py-3 text-right">מגרש</th>
                  <th className="px-4 py-3 text-right">מחיר</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {slots.map((s, i) => (
                  <tr key={s.id} className={i % 2 === 0 ? "bg-white" : "bg-mint"}>
                    <td className="px-4 py-3">{s.club_name}</td>
                    <td className="px-4 py-3">{s.date}</td>
                    <td className="px-4 py-3">{s.hour}:{String(s.minutes_offset).padStart(2, "0")}</td>
                    <td className="px-4 py-3">מגרש {s.court_number}</td>
                    <td className="px-4 py-3">
                      {s.is_free ? (
                        <span className="font-bold text-court">חינם</span>
                      ) : (
                        <>₪{s.price}{s.is_member_price && <span className="mr-1 text-xs text-court">מחיר חבר</span>}</>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => book(s)}
                        className="bg-court text-white px-4 py-1 rounded-lg hover:bg-court-dark text-xs">
                        הזמן
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ChatWidget />
    </main>
  );
}
