"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Download } from "lucide-react";
import api from "@/lib/api";
import { useActiveClubName } from "@/lib/useActiveClubName";

type Order = {
  id: number; user_name: string; user_phone: string;
  club_name: string; court_number: number;
  date: string; hour: number; minutes_offset: number;
  status: string; total_price: number; payment_method: string;
};

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

export default function AdminPage() {
  const router = useRouter();
  const clubName = useActiveClubName();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState(isoDaysAgo(30));
  const [toDate, setToDate] = useState(new Date().toISOString().split("T")[0]);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/admin/orders?from_date=${fromDate}&to_date=${toDate}`);
      setOrders(res.data);
    } catch (e: any) {
      if (e.response?.status === 403) router.push("/search");
      else setError("שגיאה בטעינת הזמנות");
    } finally {
      setLoading(false);
    }
  }

  const totalRevenue = orders
    .filter(o => o.status !== "canceled")
    .reduce((sum, o) => sum + (o.total_price || 0), 0);

  async function cancelOrder(id: number) {
    setCancelId(id);
    try {
      await api.post(`/admin/orders/${id}/cancel`);
      setOrders(o => o.filter(x => x.id !== id));
    } catch {
      setError("שגיאה בביטול הזמנה");
    } finally {
      setCancelId(null);
    }
  }

  const statusLabel = (s: string) => s === "completed" ? "הושלם" : s === "canceled" ? "מבוטל" : "ממתין";
  const statusColor = (s: string) => s === "completed" ? "bg-mint text-court" : s === "canceled" ? "bg-red-100 text-red-600" : "bg-yellow-100 text-yellow-700";

  function exportExcel() {
    if (orders.length === 0) return;
    const headers = ["מזהה", "לקוח", "טלפון", "מועדון", "מגרש", "תאריך", "שעה", "מחיר", "אמצעי תשלום", "סטטוס"];
    const rows = orders.map(o => [
      o.id,
      o.user_name,
      o.user_phone,
      o.club_name,
      o.court_number,
      o.date,
      `${o.hour}:${String(o.minutes_offset).padStart(2, "0")}`,
      o.total_price,
      o.payment_method === "credit" ? "אשראי" : "כרטיסייה",
      statusLabel(o.status),
    ]);
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
    // UTF-8 BOM so Excel renders Hebrew correctly
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `baco-orders_${fromDate}_${toDate}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-canvas p-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h1 className="text-2xl font-bold text-ink">ניהול הזמנות{clubName ? ` - ${clubName}` : ""}</h1>
          <div className="flex flex-wrap gap-4">
            <Link href="/admin/schedule" className="text-sm text-court hover:underline">עריכת לוח זמנים</Link>
            <Link href="/admin/permissions" className="text-sm text-court hover:underline">ניהול הרשאות</Link>
            <Link href="/admin/receipts" className="text-sm text-court hover:underline">דוח תקבולים</Link>
            <Link href="/admin/audit" className="text-sm text-court hover:underline">יומן פעולות</Link>
          </div>
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
          <button onClick={exportExcel} disabled={orders.length === 0}
            title="ייצוא ההזמנות המוצגות לקובץ אקסל"
            className="ms-auto flex items-center gap-2 border border-court text-court px-5 py-2 rounded-lg font-semibold hover:bg-mint transition disabled:opacity-40 disabled:cursor-not-allowed">
            <Download size={17} />
            ייצוא לאקסל
          </button>
        </div>

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        {loading && <p className="text-center text-muted">טוען...</p>}
        {!loading && orders.length === 0 && <p className="text-center text-muted">אין הזמנות לטווח התאריכים</p>}

        {!loading && orders.length > 0 && (
          <div className="flex gap-6 mb-3 text-sm text-ink">
            <span>סה"כ הזמנות: <strong>{orders.length}</strong></span>
            <span>סה"כ הכנסות: <strong>₪{totalRevenue}</strong></span>
          </div>
        )}

        {orders.length > 0 && (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-ink text-white">
                <tr>
                  <th className="px-4 py-3 text-right">לקוח</th>
                  <th className="px-4 py-3 text-right">מגרש</th>
                  <th className="px-4 py-3 text-right">תאריך</th>
                  <th className="px-4 py-3 text-right">שעה</th>
                  <th className="px-4 py-3 text-right">מחיר</th>
                  <th className="px-4 py-3 text-right">תשלום</th>
                  <th className="px-4 py-3 text-right">סטטוס</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o, i) => (
                  <tr key={o.id} className={i % 2 === 0 ? "bg-white" : "bg-canvas"}>
                    <td className="px-4 py-3">
                      <p>{o.user_name}</p>
                      <p className="text-xs text-muted">{o.user_phone}</p>
                    </td>
                    <td className="px-4 py-3">{o.club_name} #{o.court_number}</td>
                    <td className="px-4 py-3">{o.date}</td>
                    <td className="px-4 py-3">{o.hour}:{String(o.minutes_offset).padStart(2, "0")}</td>
                    <td className="px-4 py-3">₪{o.total_price}</td>
                    <td className="px-4 py-3">{o.payment_method === "credit" ? "אשראי" : "כרטיסייה"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${statusColor(o.status)}`}>
                        {statusLabel(o.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {o.status !== "canceled" && (
                        <button onClick={() => cancelOrder(o.id)} disabled={cancelId === o.id}
                          className="bg-red-500 text-white px-3 py-1 rounded text-xs hover:bg-red-600 disabled:opacity-50">
                          בטל
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
