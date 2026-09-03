"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Download } from "lucide-react";
import api from "@/lib/api";
import { useActiveClubName } from "@/lib/useActiveClubName";

type CreditOrder = {
  date: string; order_id: number; user_name: string;
  court_number: number; amount: number; status: string;
};
type TicketPurchase = {
  date: string; user_name: string; description: string;
  amount: number; approval_number: string;
};
type Report = {
  credit_orders: CreditOrder[];
  ticket_purchases: TicketPurchase[];
  credit_total: number;
  ticket_total: number;
  grand_total: number;
};

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

export default function ReceiptsPage() {
  const router = useRouter();
  const clubName = useActiveClubName();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState(isoDaysAgo(30));
  const [toDate, setToDate] = useState(new Date().toISOString().split("T")[0]);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/admin/receipts?from_date=${fromDate}&to_date=${toDate}`);
      setReport(res.data);
    } catch (e: any) {
      if (e.response?.status === 403) router.push("/search");
      else setError("שגיאה בטעינת הדוח");
    } finally {
      setLoading(false);
    }
  }

  const statusLabel = (s: string) => s === "canceled" ? "בוטל" : "בוצע";
  const statusColor = (s: string) => s === "canceled" ? "bg-red-100 text-red-600" : "bg-mint text-court";

  function exportExcel() {
    if (!report) return;
    const rows: (string | number)[][] = [["דוח תקבולים", `${fromDate} עד ${toDate}`, clubName || ""]];
    rows.push([]);
    rows.push(["הזמנות מגרש - אשראי"]);
    rows.push(["תאריך", "מספר הזמנה", "לקוח", "מגרש", "סכום", "סטטוס"]);
    report.credit_orders.forEach(o =>
      rows.push([o.date, o.order_id, o.user_name, o.court_number, o.amount, statusLabel(o.status)]));
    rows.push(["", "", "", "", "סה\"כ אשראי:", report.credit_total]);
    rows.push([]);
    rows.push(["רכישת כרטיסיות"]);
    rows.push(["תאריך", "לקוח", "כרטיסייה", "סכום", "מספר אישור"]);
    report.ticket_purchases.forEach(t =>
      rows.push([t.date, t.user_name, t.description, t.amount, t.approval_number]));
    rows.push(["", "", "", "סה\"כ כרטיסיות:", report.ticket_total]);
    rows.push([]);
    rows.push(["", "", "", "", "סה\"כ תקבולים:", report.grand_total]);

    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = rows.map(r => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `baco-receipts_${fromDate}_${toDate}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const hasRows = report && (report.credit_orders.length > 0 || report.ticket_purchases.length > 0);

  return (
    <main className="min-h-screen bg-canvas p-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h1 className="text-2xl font-bold text-ink">דוח תקבולים{clubName ? ` - ${clubName}` : ""}</h1>
          <Link href="/admin" className="text-sm text-court hover:underline">חזרה לניהול</Link>
        </div>

        <div className="bg-white rounded-xl shadow p-4 mb-4 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">מתאריך</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">עד תאריך</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
          </div>
          <button onClick={load}
            className="bg-court text-white px-6 py-2 rounded-lg hover:bg-court-dark transition">
            הצג דוח
          </button>
          <button onClick={exportExcel} disabled={!hasRows}
            title="ייצוא הדוח לקובץ אקסל"
            className="ms-auto flex items-center gap-2 border border-court text-court px-5 py-2 rounded-lg font-semibold hover:bg-mint transition disabled:opacity-40 disabled:cursor-not-allowed">
            <Download size={17} />
            ייצוא לאקסל
          </button>
        </div>

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        {loading && <p className="text-center text-muted">טוען...</p>}
        {!loading && !hasRows && <p className="text-center text-muted">אין תקבולים לטווח התאריכים</p>}

        {!loading && report && hasRows && (
          <>
            <div className="flex flex-wrap gap-6 mb-4 text-sm text-ink bg-white rounded-xl shadow p-4">
              <span>תקבולי אשראי (מגרשים): <strong>₪{report.credit_total}</strong></span>
              <span>תקבולי כרטיסיות: <strong>₪{report.ticket_total}</strong></span>
              <span className="text-court">סה"כ תקבולים: <strong>₪{report.grand_total}</strong></span>
            </div>

            {/* Credit-card court bookings */}
            <h2 className="text-lg font-semibold text-ink mb-2">הזמנות מגרש - אשראי</h2>
            {report.credit_orders.length === 0 ? (
              <p className="text-muted text-sm mb-6">אין תקבולי אשראי בטווח.</p>
            ) : (
              <div className="bg-white rounded-xl shadow overflow-hidden mb-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead className="bg-ink text-white">
                      <tr>
                        <th className="px-4 py-3 text-right">תאריך</th>
                        <th className="px-4 py-3 text-right">מס' הזמנה</th>
                        <th className="px-4 py-3 text-right">לקוח</th>
                        <th className="px-4 py-3 text-right">מגרש</th>
                        <th className="px-4 py-3 text-right">סכום</th>
                        <th className="px-4 py-3 text-right">סטטוס</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.credit_orders.map((o, i) => (
                        <tr key={o.order_id} className={i % 2 === 0 ? "bg-white" : "bg-canvas"}>
                          <td className="px-4 py-3">{o.date}</td>
                          <td className="px-4 py-3">#{o.order_id}</td>
                          <td className="px-4 py-3">{o.user_name}</td>
                          <td className="px-4 py-3">מגרש {o.court_number}</td>
                          <td className="px-4 py-3">₪{o.amount}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded-full ${statusColor(o.status)}`}>
                              {statusLabel(o.status)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Ticket / punch-card purchases */}
            <h2 className="text-lg font-semibold text-ink mb-2">רכישת כרטיסיות</h2>
            {report.ticket_purchases.length === 0 ? (
              <p className="text-muted text-sm mb-6">אין רכישות כרטיסיות בטווח.</p>
            ) : (
              <div className="bg-white rounded-xl shadow overflow-hidden mb-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead className="bg-ink text-white">
                      <tr>
                        <th className="px-4 py-3 text-right">תאריך</th>
                        <th className="px-4 py-3 text-right">לקוח</th>
                        <th className="px-4 py-3 text-right">כרטיסייה</th>
                        <th className="px-4 py-3 text-right">סכום</th>
                        <th className="px-4 py-3 text-right">מס' אישור</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.ticket_purchases.map((t, i) => (
                        <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-canvas"}>
                          <td className="px-4 py-3">{t.date}</td>
                          <td className="px-4 py-3">{t.user_name}</td>
                          <td className="px-4 py-3">{t.description}</td>
                          <td className="px-4 py-3">₪{t.amount}</td>
                          <td className="px-4 py-3">{t.approval_number}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
