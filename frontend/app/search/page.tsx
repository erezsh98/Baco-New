"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";

type Area = { id: number; description: string };
type Club = { id: number; club_name: string };
type Slot = {
  id: number; club_name: string; club_id: number;
  court_number: number; surface_type: string;
  date: string; hour: number; minutes_offset: number;
  member_price: number; non_member_price: number;
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

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("from_date", form.from_date);
      params.set("to_date", form.to_date || form.from_date);
      if (form.from_hour) params.set("from_hour", form.from_hour);
      if (form.to_hour) params.set("to_hour", form.to_hour);
      if (form.area_id) params.set("area_id", form.area_id);
      if (form.club_id) params.set("club_id", form.club_id);
      const res = await api.get(`/courts/search?${params}`);
      setSlots(res.data);
      setSearched(true);
    } catch {
      setError("שגיאה בחיפוש. אנא נסה שוב.");
    } finally {
      setLoading(false);
    }
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
    <main className="min-h-screen bg-green-50 p-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-green-800 mb-6 text-center">חיפוש מגרש טניס</h1>

        <form onSubmit={search} className="bg-white rounded-2xl shadow p-6 mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">תאריך</label>
            <input type="date" name="from_date" required min={today} value={form.from_date}
              onChange={handle} className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">שעה מ-</label>
            <input type="number" name="from_hour" min={6} max={22} placeholder="6"
              value={form.from_hour} onChange={handle}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">שעה עד-</label>
            <input type="number" name="to_hour" min={6} max={23} placeholder="22"
              value={form.to_hour} onChange={handle}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">אזור</label>
            <select name="area_id" value={form.area_id} onChange={handle}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="">כל האזורים</option>
              {areas.map(a => <option key={a.id} value={a.id}>{a.description}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">מועדון</label>
            <select name="club_id" value={form.club_id} onChange={handle}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="">כל המועדונים</option>
              {clubs.map(c => <option key={c.id} value={c.id}>{c.club_name}</option>)}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-3 flex justify-center">
            <button type="submit" disabled={loading}
              className="bg-green-700 text-white px-8 py-2 rounded-lg hover:bg-green-800 transition disabled:opacity-50">
              {loading ? "מחפש..." : "חפש"}
            </button>
          </div>
        </form>

        {error && <p className="text-red-600 text-center mb-4">{error}</p>}

        {searched && slots.length === 0 && (
          <p className="text-center text-gray-500">לא נמצאו מגרשים פנויים לתאריך ושעה שנבחרו.</p>
        )}

        {slots.length > 0 && (
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-green-700 text-white">
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
                  <tr key={s.id} className={i % 2 === 0 ? "bg-white" : "bg-green-50"}>
                    <td className="px-4 py-3">{s.club_name}</td>
                    <td className="px-4 py-3">{s.date}</td>
                    <td className="px-4 py-3">{s.hour}:{String(s.minutes_offset).padStart(2, "0")}</td>
                    <td className="px-4 py-3">מגרש {s.court_number}</td>
                    <td className="px-4 py-3">₪{s.non_member_price}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => book(s)}
                        className="bg-green-700 text-white px-4 py-1 rounded-lg hover:bg-green-800 text-xs">
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
    </main>
  );
}
