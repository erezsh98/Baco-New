"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";

type Slot = {
  id: number; club_name: string; club_id: number;
  court_number: number; date: string; hour: number; minutes_offset: number;
  member_price: number; non_member_price: number;
};

type Ticket = { id: number; club_ticket_id: number; ticket_name: string; unlimited: boolean; punches_left: number | null };

export default function PaymentPage() {
  const router = useRouter();
  const [slot, setSlot] = useState<Slot | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [orderLimit, setOrderLimit] = useState(false);
  const [payMethod, setPayMethod] = useState<"credit" | "ticket">("credit");
  const [selectedTicket, setSelectedTicket] = useState<number | null>(null);
  const [iframeHtml, setIframeHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("selected_slot");
    if (!saved) { router.push("/search"); return; }
    const s: Slot = JSON.parse(saved);
    setSlot(s);
    const token = localStorage.getItem("access_token");
    if (token) {
      // Slot-aware: only כרטיסיות valid for this slot's day/hour (ticket_active_time)
      api.get(`/tickets/for-slot?slot_id=${s.id}`)
        .then(r => { setTickets(r.data.tickets); setOrderLimit(r.data.order_limit); })
        .catch(() => {});
    }
  }, []);

  async function proceedCredit() {
    if (!slot) return;
    setError(""); setLoading(true);
    try {
      const res = await api.post("/bookings/create", {
        slot_id: slot.id,
        payment_method: "credit",
      });
      setIframeHtml(res.data.iframe_html);
    } catch (e: any) {
      setError(e.response?.data?.detail || "שגיאה ביצירת הזמנה");
    } finally {
      setLoading(false);
    }
  }

  async function proceedTicket() {
    if (!slot || !selectedTicket) return;
    setError(""); setLoading(true);
    try {
      await api.post("/bookings/create", {
        slot_id: slot.id,
        payment_method: "ticket",
        customer_ticket_id: selectedTicket,
      });
      localStorage.removeItem("selected_slot");
      router.push("/booking/thank-you");
    } catch (e: any) {
      setError(e.response?.data?.detail || "שגיאה בשימוש בכרטיס");
    } finally {
      setLoading(false);
    }
  }

  if (!slot) return null;

  if (iframeHtml) {
    return (
      <main className="min-h-screen bg-green-50 p-4">
        <div className="max-w-xl mx-auto bg-white rounded-2xl shadow p-4">
          <h2 className="text-xl font-bold text-green-800 mb-4 text-center">תשלום בכרטיס אשראי</h2>
          <div dangerouslySetInnerHTML={{ __html: iframeHtml }} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-green-50 p-4">
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-bold text-green-800 mb-6 text-center">אמצעי תשלום</h1>

        <div className="bg-white rounded-2xl shadow p-6 mb-4">
          <h2 className="font-semibold text-gray-700 mb-2">פרטי ההזמנה</h2>
          <p className="text-sm text-gray-600">{slot.club_name} — מגרש {slot.court_number}</p>
          <p className="text-sm text-gray-600">{slot.date} | {slot.hour}:{String(slot.minutes_offset).padStart(2, "0")}</p>
          <p className="text-sm font-bold text-green-700 mt-1">₪{slot.non_member_price}</p>
        </div>

        {error && <p className="text-red-600 text-sm mb-4 text-center">{error}</p>}

        {orderLimit ? (
          <div className="bg-white rounded-2xl shadow p-6 text-center">
            <p className="text-red-600 font-semibold">הגעת למכסת ההזמנות היומית בכרטיסייה שלך.</p>
            <button onClick={() => router.back()} className="mt-4 text-gray-500 text-sm hover:underline">חזור לחיפוש</button>
          </div>
        ) : (
        <div className="bg-white rounded-2xl shadow p-6 space-y-4">
          <div className="flex gap-4">
            <button onClick={() => setPayMethod("credit")}
              className={`flex-1 py-2 rounded-lg border-2 transition ${payMethod === "credit" ? "border-green-700 bg-green-50 font-bold" : "border-gray-200"}`}>
              כרטיס אשראי
            </button>
            <button onClick={() => setPayMethod("ticket")} disabled={tickets.length === 0}
              className={`flex-1 py-2 rounded-lg border-2 transition ${payMethod === "ticket" ? "border-green-700 bg-green-50 font-bold" : "border-gray-200"} disabled:opacity-40`}>
              כרטיסייה
            </button>
          </div>

          {payMethod === "ticket" && tickets.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">בחר כרטיסייה:</p>
              {tickets.map(t => (
                <label key={t.id} className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer ${selectedTicket === t.id ? "border-green-600 bg-green-50" : "border-gray-200"}`}>
                  <input type="radio" name="ticket" value={t.id}
                    checked={selectedTicket === t.id} onChange={() => setSelectedTicket(t.id)} />
                  <span className="text-sm">{t.ticket_name} — {t.unlimited ? "ללא הגבלה" : `${t.punches_left} כניסות נותרו`}</span>
                </label>
              ))}
            </div>
          )}

          <button
            onClick={payMethod === "credit" ? proceedCredit : proceedTicket}
            disabled={loading || (payMethod === "ticket" && !selectedTicket)}
            className="w-full bg-green-700 text-white py-3 rounded-lg hover:bg-green-800 transition disabled:opacity-50 font-semibold">
            {loading ? "מעבד..." : "אישור הזמנה"}
          </button>
          <button onClick={() => router.back()} className="w-full text-gray-500 text-sm hover:underline">חזור לחיפוש</button>
        </div>
        )}
      </div>
    </main>
  );
}
