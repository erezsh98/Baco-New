"use client";
import { useState } from "react";
import api from "@/lib/api";

const FAQ = [
  { q: "כיצד מבטלים הזמנה?", a: "ניתן לבטל הזמנה עד 24 שעות לפני המשחק מעמוד 'ההזמנות שלי'." },
  { q: "האם ניתן לשנות מגרש?", a: "לא ניתן לשנות מגרש לאחר ההזמנה. יש לבטל ולהזמין מחדש." },
  { q: "כמה זמן מראש ניתן להזמין?", a: "ניתן להזמין עד 7 ימים מראש." },
  { q: "מה קורה אם נגמרות הכניסות בכרטיסייה?", a: "יש לרכוש כרטיסייה חדשה בעמוד 'רכישת כרטיסייה'." },
  { q: "כיצד ניתן לפתוח את השער?", a: "השער נפתח אוטומטית עם מספר הטלפון שרשמת לאחר ביצוע הזמנה." },
];

export default function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  function handle(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await api.post("/contact", form);
      setSent(true);
    } catch (err: any) {
      setError(err.response?.data?.detail || "שגיאה בשליחה");
    } finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen bg-green-50 p-4">
      <div className="max-w-2xl mx-auto space-y-8">
        <h1 className="text-2xl font-bold text-green-800 text-center">צור קשר ושאלות נפוצות</h1>

        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">שאלות נפוצות</h2>
          <div className="space-y-2">
            {FAQ.map((item, i) => (
              <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full text-right px-4 py-3 text-sm font-medium text-gray-700 hover:bg-green-50 flex justify-between items-center">
                  <span>{item.q}</span>
                  <span className="text-green-600">{openFaq === i ? "▲" : "▼"}</span>
                </button>
                {openFaq === i && (
                  <div className="px-4 pb-3 text-sm text-gray-600 bg-green-50">{item.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">שלח הודעה</h2>
          {sent ? (
            <p className="text-green-700 text-center py-4">ההודעה נשלחה! נחזור אליך בהקדם.</p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">שם מלא</label>
                <input name="name" required value={form.name} onChange={handle}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">אימייל</label>
                <input name="email" type="email" required value={form.email} onChange={handle}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">הודעה</label>
                <textarea name="message" required rows={4} value={form.message} onChange={handle}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <button type="submit" disabled={loading}
                className="w-full bg-green-700 text-white py-2 rounded-lg hover:bg-green-800 disabled:opacity-50">
                {loading ? "שולח..." : "שלח"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
