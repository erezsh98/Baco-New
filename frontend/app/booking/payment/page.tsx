"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";

type Slot = {
  id: number; club_name: string; club_id: number;
  court_number: number; date: string; hour: number; minutes_offset: number;
  member_price: number; non_member_price: number;
  price?: number; is_member_price?: boolean; is_free?: boolean;
  covered_by_subscription?: boolean;
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
      // Re-price the slot for the now-authenticated user — member pricing (חבר מועדון)
      // may apply, which the unauthenticated search couldn't know.
      api.get(`/courts/${s.id}`)
        .then(r => setSlot(cur => (cur ? { ...cur, ...r.data } : r.data)))
        .catch(() => {});
      // Slot-aware: only כרטיסיות valid for this slot's day/hour (ticket_active_time)
      api.get(`/tickets/for-slot?slot_id=${s.id}`)
        .then(r => {
          setTickets(r.data.tickets);
          setOrderLimit(r.data.order_limit);
          // When the user has any eligible כרטיסייה (a מנוי or a punch-card),
          // open the כרטיסייה tab so they see and choose it — but don't pre-pick.
          if (r.data.tickets?.length > 0) setPayMethod("ticket");
        })
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
      if (res.data.confirmed) {
        // dev mode / no payment gateway — the order is already confirmed
        rememberBooking();
        localStorage.removeItem("selected_slot");
        router.push("/booking/thank-you");
        return;
      }
      if (res.data.iframe_html) {
        setIframeHtml(res.data.iframe_html);
      } else {
        setError("שגיאה: לא התקבל מסך תשלום. נסו שוב או פנו לתמיכה.");
      }
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
      rememberBooking();
      localStorage.removeItem("selected_slot");
      router.push("/booking/thank-you");
    } catch (e: any) {
      setError(e.response?.data?.detail || "שגיאה בשימוש בכרטיס");
    } finally {
      setLoading(false);
    }
  }

  function rememberBooking() {
    if (!slot) return;
    localStorage.setItem("last_booking", JSON.stringify({
      club_id: slot.club_id,
      club_name: slot.club_name,
      date: slot.date,
      hour: slot.hour,
      minutes_offset: slot.minutes_offset,
    }));
  }

  if (!slot) return null;

  if (iframeHtml) {
    return (
      <main className="min-h-screen bg-mint p-4">
        <div className="max-w-xl mx-auto bg-white rounded-2xl shadow p-4">
          <h2 className="text-xl font-bold text-court-dark mb-4 text-center">תשלום בכרטיס אשראי</h2>
          <div dangerouslySetInnerHTML={{ __html: iframeHtml }} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-mint p-4">
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-bold text-court-dark mb-6 text-center">אמצעי תשלום</h1>

        <div className="bg-white rounded-2xl shadow p-6 mb-4">
          <h2 className="font-semibold text-ink mb-2">פרטי ההזמנה</h2>
          <p className="text-sm text-muted">{slot.club_name} — מגרש {slot.court_number}</p>
          <p className="text-sm text-muted">{slot.date} | {slot.hour}:{String(slot.minutes_offset).padStart(2, "0")}</p>
          <p className="text-sm font-bold text-court mt-1">
            {slot.covered_by_subscription ? "כלול במנוי" : slot.is_free ? "ללא עלות" : `₪${slot.price ?? slot.non_member_price}`}
            {slot.is_member_price && !slot.is_free && !slot.covered_by_subscription && <span className="mr-2 text-xs text-court">(מחיר חבר מועדון)</span>}
            {slot.covered_by_subscription && <span className="mr-2 text-xs text-court">(בחרו כרטיסייה למטה)</span>}
          </p>
        </div>

        {error && <p className="text-red-600 text-sm mb-4 text-center">{error}</p>}

        {orderLimit ? (
          <div className="bg-white rounded-2xl shadow p-6 text-center">
            <p className="text-red-600 font-semibold">הגעת למכסת ההזמנות היומית בכרטיסייה שלך.</p>
            <button onClick={() => router.back()} className="mt-4 text-muted text-sm hover:underline">חזור לחיפוש</button>
          </div>
        ) : slot.is_free ? (
          <div className="bg-white rounded-2xl shadow p-6 space-y-4 text-center">
            <p className="text-court font-semibold">הזמנה זו ללא עלות (חבר מועדון) 🎾</p>
            <button onClick={proceedCredit} disabled={loading}
              className="w-full bg-court text-white py-3 rounded-lg hover:bg-court-dark transition disabled:opacity-50 font-semibold">
              {loading ? "מעבד..." : "אישור הזמנה"}
            </button>
            <button onClick={() => router.back()} className="w-full text-muted text-sm hover:underline">חזור לחיפוש</button>
          </div>
        ) : (
        <div className="bg-white rounded-2xl shadow p-6 space-y-4">
          <div className="flex gap-4">
            <button onClick={() => setPayMethod("credit")}
              className={`flex-1 py-2 rounded-lg border-2 transition ${payMethod === "credit" ? "border-court bg-mint font-bold" : "border-line"}`}>
              כרטיס אשראי
            </button>
            <button onClick={() => setPayMethod("ticket")} disabled={tickets.length === 0}
              className={`flex-1 py-2 rounded-lg border-2 transition ${payMethod === "ticket" ? "border-court bg-mint font-bold" : "border-line"} disabled:opacity-40`}>
              כרטיסייה
            </button>
          </div>

          {payMethod === "ticket" && tickets.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted">בחר כרטיסייה:</p>
              {tickets.map(t => (
                <label key={t.id} className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer ${selectedTicket === t.id ? "border-court bg-mint" : "border-line"}`}>
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
            className="w-full bg-court text-white py-3 rounded-lg hover:bg-court-dark transition disabled:opacity-50 font-semibold">
            {loading ? "מעבד..." : "אישור הזמנה"}
          </button>
          <button onClick={() => router.back()} className="w-full text-muted text-sm hover:underline">חזור לחיפוש</button>
        </div>
        )}
      </div>
    </main>
  );
}
