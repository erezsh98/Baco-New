"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import SearchForm, { SearchValues } from "@/components/SearchForm";

const RESULTS_PER_PAGE = 15;

type Slot = {
  id: number; club_name: string; club_id: number;
  court_number: number; surface_type: string;
  date: string; hour: number; minutes_offset: number;
  member_price: number; non_member_price: number;
  price: number; is_member_price: boolean; is_free: boolean;
  covered_by_subscription: boolean;
};

export default function SearchPage() {
  const router = useRouter();
  const [initial, setInitial] = useState<Partial<SearchValues>>({});
  const [slots, setSlots] = useState<Slot[]>([]);
  const [page, setPage] = useState(0);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Prefill from the URL query (e.g. arriving from the homepage hero search or a
  // shared link) and auto-search. Runs once on mount.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if ([...sp.keys()].length === 0) return;
    const init: SearchValues = {
      from_date: sp.get("from_date") || "",
      from_hour: sp.get("from_hour") || "",
      to_hour: sp.get("to_hour") || "",
      area_id: sp.get("area_id") || "",
      club_id: sp.get("club_id") || "",
    };
    setInitial(init);
    if (init.from_date) runSearch(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSearch(v: SearchValues) {
    setError(""); setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("from_date", v.from_date);
      params.set("to_date", v.from_date);
      if (v.from_hour) params.set("from_hour", v.from_hour);
      if (v.to_hour) params.set("to_hour", v.to_hour);
      if (v.area_id) params.set("area_id", v.area_id);
      if (v.club_id) params.set("club_id", v.club_id);
      const res = await api.get(`/courts/search?${params}`);
      setSlots(res.data);
      setPage(0);
      setSearched(true);
    } catch {
      setError("שגיאה בחיפוש. אנא נסה שוב.");
    } finally {
      setLoading(false);
    }
  }

  // Submit from the shared form: reflect the filters in the URL (shareable /
  // bookmarkable / back-button friendly), then search in place.
  function handleSearch(v: SearchValues) {
    const p = new URLSearchParams();
    p.set("from_date", v.from_date);
    p.set("from_hour", v.from_hour);
    p.set("to_hour", v.to_hour);
    if (v.area_id) p.set("area_id", v.area_id);
    if (v.club_id) p.set("club_id", v.club_id);
    router.push(`/search?${p.toString()}`);
    runSearch(v);
  }

  function book(slot: Slot) {
    // Save the chosen slot first so the reservation survives an auth detour.
    localStorage.setItem("selected_slot", JSON.stringify(slot));
    if (!localStorage.getItem("access_token")) {
      // Old flow: choosing a court redirects to the (secured) payment step, which
      // sends an unauthenticated user to the login screen, then continues the order.
      router.push("/login?next=/booking/payment");
      return;
    }
    router.push("/booking/payment");
  }

  const totalPages = Math.max(1, Math.ceil(slots.length / RESULTS_PER_PAGE));
  const curPage = Math.min(page, totalPages - 1);
  const pageSlots = slots.slice(curPage * RESULTS_PER_PAGE, curPage * RESULTS_PER_PAGE + RESULTS_PER_PAGE);

  return (
    <main className="min-h-screen bg-mint p-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-court-dark mb-6 text-center">חיפוש מגרש פנוי</h1>

        <div className="mb-6">
          {/* Same hero card as the home page; re-mount (key) when the URL prefill
              arrives so the fields pick up the incoming values. */}
          <SearchForm key={JSON.stringify(initial)} initial={initial} onSearch={handleSearch} />
        </div>

        {loading && <p className="text-center text-muted mb-4">מחפש...</p>}
        {error && <p className="text-red-600 text-center mb-4">{error}</p>}

        {searched && !loading && slots.length === 0 && (
          <p className="text-center text-muted">לא נמצאו מגרשים פנויים לתאריך ושעה שנבחרו.</p>
        )}

        {slots.length > 0 && (
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="bg-court text-white">
                <tr>
                  <th className="px-4 py-3 text-right">מועדון</th>
                  <th className="px-4 py-3 text-right">תאריך</th>
                  <th className="px-4 py-3 text-right">שעה</th>
                  <th className="px-4 py-3 text-right">מגרש</th>
                  <th className="px-4 py-3 text-right">משטח</th>
                  <th className="px-4 py-3 text-right">מחיר</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {pageSlots.map((s, i) => (
                  <tr key={s.id} className={i % 2 === 0 ? "bg-white" : "bg-mint"}>
                    <td className="px-4 py-3">{s.club_name}</td>
                    <td className="px-4 py-3">{s.date}</td>
                    <td className="px-4 py-3">{s.hour}:{String(s.minutes_offset).padStart(2, "0")}</td>
                    <td className="px-4 py-3">מגרש {s.court_number}</td>
                    <td className="px-4 py-3">{s.surface_type || "—"}</td>
                    <td className="px-4 py-3">
                      {s.covered_by_subscription ? (
                        <span className="font-bold text-court">כלול במנוי</span>
                      ) : s.is_free ? (
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

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 py-3 text-sm border-t border-line">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={curPage === 0}
                  className="px-3 py-1 rounded-lg border border-line hover:bg-mint disabled:opacity-40 disabled:cursor-not-allowed">‹ הקודם</button>
                <span className="text-muted">עמוד {curPage + 1} מתוך {totalPages} ({slots.length} תוצאות)</span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={curPage >= totalPages - 1}
                  className="px-3 py-1 rounded-lg border border-line hover:bg-mint disabled:opacity-40 disabled:cursor-not-allowed">הבא ›</button>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
