"use client";
import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";

function ResetForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [email, setEmail] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function requestReset(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await api.post("/auth/reset-password/request", { email });
      setSent(true);
    } catch (err: any) {
      setError(err.response?.data?.detail || "שגיאה בשליחת הבקשה");
    } finally { setLoading(false); }
  }

  async function doReset(e: React.FormEvent) {
    e.preventDefault();
    if (newPass !== confirm) { setError("הסיסמאות אינן תואמות"); return; }
    setError(""); setLoading(true);
    try {
      await api.post("/auth/reset-password/confirm", { token, new_password: newPass });
      router.push("/login?reset=1");
    } catch (err: any) {
      setError(err.response?.data?.detail || "שגיאה באיפוס סיסמה");
    } finally { setLoading(false); }
  }

  if (token) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-court-dark mb-6 text-center">איפוס סיסמה</h1>
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        <form onSubmit={doReset} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">סיסמה חדשה</label>
            <input type="password" required value={newPass} onChange={e => setNewPass(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">אימות סיסמה</label>
            <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-court text-white py-2 rounded-lg hover:bg-court-dark disabled:opacity-50">
            {loading ? "שומר..." : "שמור סיסמה"}
          </button>
        </form>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
        <h1 className="text-2xl font-bold text-court-dark mb-4">בדוק את האימייל שלך</h1>
        <p className="text-muted mb-6">שלחנו קישור לאיפוס סיסמה לכתובת <strong>{email}</strong></p>
        <Link href="/login" className="text-court hover:underline text-sm">חזור להתחברות</Link>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
      <h1 className="text-2xl font-bold text-court-dark mb-6 text-center">שכחת סיסמה?</h1>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      <form onSubmit={requestReset} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">אימייל</label>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court" />
        </div>
        <button type="submit" disabled={loading}
          className="w-full bg-court text-white py-2 rounded-lg hover:bg-court-dark disabled:opacity-50">
          {loading ? "שולח..." : "שלח קישור לאיפוס"}
        </button>
      </form>
      <p className="text-center text-sm text-muted mt-4">
        <Link href="/login" className="text-court hover:underline">חזור לכניסה</Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-mint p-4">
      <Suspense fallback={<div className="text-muted">טוען...</div>}>
        <ResetForm />
      </Suspense>
    </main>
  );
}
