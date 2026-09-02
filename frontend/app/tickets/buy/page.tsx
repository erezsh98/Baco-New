"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";

type Club = { id: number; club_name: string };
type TicketPackage = { id: number; ticket_name: string; num_of_punches: number; price: number; valid_days: number };

export default function BuyTicketPage() {
  const router = useRouter();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [selectedClub, setSelectedClub] = useState<number | null>(null);
  const [packages, setPackages] = useState<TicketPackage[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [iframeHtml, setIframeHtml] = useState("");
  const [error, setError] = useState("");
  const [clubQuery, setClubQuery] = useState("");     // searchable club dropdown
  const [clubOpen, setClubOpen] = useState(false);

  useEffect(() => {
    api.get("/clubs").then(r => setClubs(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedClub) {
      api.get(`/tickets/packages?club_id=${selectedClub}`).then(r => setPackages(r.data)).catch(() => setPackages([]));
    }
  }, [selectedClub]);

  async function purchase() {
    if (!selected) return;
    setError(""); setLoading(true);
    try {
      const res = await api.post("/tickets/purchase", { club_ticket_id: selected });
      if (res.data.iframe_html) setIframeHtml(res.data.iframe_html);
      else router.push("/tickets");
    } catch (e: any) {
      setError(e.response?.data?.detail || "שגיאה ברכישה");
    } finally {
      setLoading(false);
    }
  }

  function pickClub(c: Club) {
    setSelectedClub(c.id); setSelected(null); setClubQuery(c.club_name); setClubOpen(false);
  }
  const cq = clubQuery.trim().toLowerCase();
  const clubMatches = cq ? clubs.filter(c => c.club_name.toLowerCase().includes(cq)) : clubs;

  if (iframeHtml) {
    return (
      <main className="min-h-screen bg-mint p-4">
        <div className="max-w-xl mx-auto bg-white rounded-2xl shadow p-4">
          <h2 className="text-xl font-bold text-court-dark mb-4 text-center">תשלום כרטיסייה</h2>
          <iframe srcDoc={iframeHtml} title="Pelecard" className="w-full rounded-lg border border-line"
            style={{ height: 600 }} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-mint p-4">
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-bold text-court-dark mb-6 text-center">רכישת כרטיסייה</h1>

        <div className="bg-white rounded-2xl shadow p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">מועדון</label>
            <div className="relative">
              <input
                value={clubQuery}
                onChange={e => { setClubQuery(e.target.value); setClubOpen(true); }}
                onFocus={e => { setClubOpen(true); e.target.select(); }}
                onBlur={() => setTimeout(() => setClubOpen(false), 150)}
                placeholder="חיפוש מועדון…"
                className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
              {clubOpen && (
                <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-line bg-white shadow-lg">
                  {clubMatches.length === 0 && <li className="px-3 py-2 text-sm text-muted">לא נמצאו מועדונים</li>}
                  {clubMatches.map(c => (
                    <li key={c.id}>
                      <button type="button" onMouseDown={() => pickClub(c)}
                        className={`w-full text-right px-3 py-2 text-sm hover:bg-mint ${c.id === selectedClub ? "bg-mint/60 font-semibold" : ""}`}>
                        {c.club_name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {packages.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">בחר חבילה:</p>
              {packages.map(p => (
                <label key={p.id} className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer ${selected === p.id ? "border-court bg-mint" : "border-line"}`}>
                  <div className="flex items-center gap-3">
                    <input type="radio" name="pkg" value={p.id} checked={selected === p.id} onChange={() => setSelected(p.id)} />
                    <div>
                      <p className="text-sm font-medium">{p.ticket_name}</p>
                      <p className="text-xs text-muted">{p.num_of_punches} כניסות | בתוקף {p.valid_days} ימים</p>
                    </div>
                  </div>
                  <p className="text-court font-bold">₪{p.price}</p>
                </label>
              ))}
            </div>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <button onClick={purchase} disabled={!selected || loading}
            className="w-full bg-court text-white py-2 rounded-lg hover:bg-court-dark transition disabled:opacity-50">
            {loading ? "מעבד..." : "רכוש עכשיו"}
          </button>
        </div>
      </div>
    </main>
  );
}
