"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import api from "@/lib/api";

type Booking = {
  id: number; order_id: number; club_name: string; court_number: number;
  date: string; hour: number; minutes_offset: number;
  is_final: string | null; amount: number | null; refund_eligible: boolean;
};

export default function PastBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(false);

  // refund modal state
  const [refundFor, setRefundFor] = useState<Booking | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [modalErr, setModalErr] = useState("");

  useEffect(() => {
    api.get("/bookings/my?future=false")
      .then(r => {
        // newest first (by date, then hour)
        const sorted = [...r.data].sort((a: Booking, b: Booking) =>
          b.date.localeCompare(a.date) || b.hour - a.hour);
        setBookings(sorted);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function openRefund(b: Booking) {
    setRefundFor(b); setReason(""); setModalErr(""); setMsg("");
  }

  async function submitRefund() {
    if (!refundFor) return;
    if (!reason.trim()) { setModalErr("יש להזין סיבה לבקשת הזיכוי"); return; }
    setSubmitting(true); setModalErr("");
    try {
      const r = await api.post(`/bookings/${refundFor.id}/refund-request`, { reason: reason.trim() });
      setRefundFor(null);
      setMsgOk(true);
      setMsg(r.data.message || "בקשת הזיכוי נשלחה למנהל המועדון.");
    } catch (e: any) {
      setModalErr(e.response?.data?.detail || "שליחת הבקשה נכשלה. נסו שוב.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-mint p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-court-dark">הזמנות עבר</h1>
          <Link href="/my-bookings" className="text-sm text-court hover:underline">הזמנות עתידיות</Link>
        </div>

        {msg && (
          <div className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium flex items-start gap-2 ${msgOk ? "bg-white text-court-dark border border-court/30" : "bg-red-50 text-red-700 border border-red-300"}`}>
            <span className="text-lg leading-none">{msgOk ? "✓" : "⚠"}</span><span>{msg}</span>
          </div>
        )}

        {loading && <p className="text-center text-muted">טוען...</p>}
        {!loading && bookings.length === 0 && (
          <p className="text-center text-muted">לא נמצאו הזמנות קודמות</p>
        )}

        <div className="space-y-3">
          {bookings.map(b => (
            <div key={b.id} className="bg-white rounded-xl shadow p-4 flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-ink">{b.club_name} — מגרש {b.court_number}</p>
                <p className="text-sm text-muted">{b.date} | שעה {String(b.hour).padStart(2, "0")}:{String(b.minutes_offset ?? 0).padStart(2, "0")}</p>
                <p className="text-sm text-court font-medium">₪{b.amount}</p>
              </div>
              <div className="flex items-center gap-3">
                {b.refund_eligible && (
                  <button onClick={() => openRefund(b)}
                    className="bg-court text-white px-4 py-2 rounded-lg text-sm hover:bg-court-dark transition">
                    בקשת זיכוי
                  </button>
                )}
                <span className={`text-xs px-2 py-1 rounded-full ${b.is_final === "Y" ? "bg-mint text-muted" : "bg-red-100 text-red-600"}`}>
                  {b.is_final === "Y" ? "הושלם" : "מבוטל"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Refund-reason modal */}
      {refundFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-bold text-ink mb-1">בקשת זיכוי</h3>
            <p className="text-sm text-muted mb-1">{refundFor.club_name} — מגרש {refundFor.court_number}</p>
            <p className="text-sm text-muted mb-4">{refundFor.date} | שעה {String(refundFor.hour).padStart(2, "0")}:{String(refundFor.minutes_offset ?? 0).padStart(2, "0")} · ₪{refundFor.amount} · אישור #{refundFor.order_id}</p>

            <label className="block text-sm font-medium text-ink mb-1">סיבת הבקשה</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={4}
              placeholder="נא לפרט את הסיבה לבקשת הזיכוי..."
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />

            {modalErr && <p className="text-red-600 text-sm mt-2">{modalErr}</p>}

            <p className="text-xs text-muted mt-3">הבקשה תישלח למנהל המועדון בדוא"ל. הזיכוי בפועל נתון לשיקול המועדון.</p>

            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setRefundFor(null)} disabled={submitting}
                className="px-5 py-2 rounded-lg border border-line hover:bg-canvas text-sm">ביטול</button>
              <button onClick={submitRefund} disabled={submitting}
                className="px-5 py-2 rounded-lg bg-court text-white hover:bg-court-dark text-sm font-semibold disabled:opacity-50">
                {submitting ? "שולח..." : "שלח בקשה"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
