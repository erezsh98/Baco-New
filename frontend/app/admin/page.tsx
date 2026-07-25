"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";

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
  const statusColor = (s: string) => s === "completed" ? "bg-green-100 text-green-700" : s === "canceled" ? "bg-red-100 text-red-600" : "bg-yellow-100 text-yellow-700";

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-800">ניהול הזמנות</h1>
          <div className="flex gap-4">
            <Link href="/admin/schedule" className="text-sm text-blue-600 hover:underline">עריכת לוח זמנים</Link>
            <Link href="/admin/permissions" className="text-sm text-blue-600 hover:underline">ניהול הרשאות</Link>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4 mb-4 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">מתאריך</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">עד תאריך</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={load}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition">
            הצג דוח
          </button>
        </div>

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        {loading && <p className="text-center text-gray-500">טוען...</p>}
        {!loading && orders.length === 0 && <p className="text-center text-gray-500">אין הזמנות לטווח התאריכים</p>}

        {!loading && orders.length > 0 && (
          <div className="flex gap-6 mb-3 text-sm text-gray-700">
            <span>סה"כ הזמנות: <strong>{orders.length}</strong></span>
            <span>סה"כ הכנסות: <strong>₪{totalRevenue}</strong></span>
          </div>
        )}

        {orders.length > 0 && (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-800 text-white">
                <tr>
                  <th className="px-4 py-3 text-right">לקוח</th>
                  <th className="px-4 py-3 text-right">מגרש</th>
                  <th className="px-4 py-3 text-right">שעה</th>
                  <th className="px-4 py-3 text-right">מחיר</th>
                  <th className="px-4 py-3 text-right">תשלום</th>
                  <th className="px-4 py-3 text-right">סטטוס</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o, i) => (
                  <tr key={o.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className="px-4 py-3">
                      <p>{o.user_name}</p>
                      <p className="text-xs text-gray-400">{o.user_phone}</p>
                    </td>
                    <td className="px-4 py-3">{o.club_name} #{o.court_number}</td>
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
        )}
      </div>
    </main>
  );
}
