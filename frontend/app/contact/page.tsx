"use client";
import { useState } from "react";
import api from "@/lib/api";

export default function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handle(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  // Client-side validation with Hebrew messages (returns the first problem, or "").
  function validate(): string {
    if (!form.name.trim()) return "יש להזין שם מלא";
    if (!form.email.trim()) return "יש להזין כתובת אימייל";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "כתובת אימייל לא תקינה";
    const digits = form.phone.replace(/\D/g, "");
    if (!digits) return "יש להזין מספר טלפון";
    if (!/^0\d{8,9}$/.test(digits)) return "מספר טלפון לא תקין";
    if (!form.message.trim()) return "יש להזין תוכן הודעה";
    return "";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const problem = validate();
    if (problem) { setError(problem); return; }
    setLoading(true);
    try {
      await api.post("/contact", form);
      setSent(true);
    } catch (err: any) {
      setError(err.response?.data?.detail || "שגיאה בשליחת ההודעה. נסו שוב מאוחר יותר.");
    } finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen bg-mint p-4">
      <div className="max-w-2xl mx-auto space-y-8">
        <h1 className="text-2xl font-bold text-court-dark text-center">צור קשר</h1>

        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-semibold text-ink mb-4">שלח הודעה</h2>
          {sent ? (
            <p className="text-court text-center py-4">ההודעה נשלחה! נחזור אליך בהקדם.</p>
          ) : (
            <form onSubmit={submit} noValidate className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">שם מלא</label>
                <input name="name" required value={form.name} onChange={handle}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">אימייל</label>
                <input name="email" type="email" required value={form.email} onChange={handle}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">טלפון</label>
                <input name="phone" type="tel" required value={form.phone} onChange={handle}
                  placeholder="05X-XXXXXXX"
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">הודעה</label>
                <textarea name="message" required rows={4} value={form.message} onChange={handle}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <button type="submit" disabled={loading}
                className="w-full bg-court text-white py-2 rounded-lg hover:bg-court-dark disabled:opacity-50">
                {loading ? "שולח..." : "שלח"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
