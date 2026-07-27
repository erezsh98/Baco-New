"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const [form, setForm] = useState({
    email: "",
    password: "",
    first_name: "",
    last_name: "",
    phone_number: "",
  });
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accepted) {
      setError("יש לאשר את תנאי התקנון");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/register", form);
      router.push(`/login?registered=1${next ? `&next=${encodeURIComponent(next)}` : ""}`);
    } catch (err: any) {
      setError(err.response?.data?.detail || "שגיאה בהרשמה, נסה שוב");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-mint p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-court-dark mb-6 text-center">הרשמה</h1>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">שם פרטי</label>
            <input
              name="first_name"
              type="text"
              required
              value={form.first_name}
              onChange={handleChange}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">שם משפחה</label>
            <input
              name="last_name"
              type="text"
              required
              value={form.last_name}
              onChange={handleChange}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">אימייל</label>
            <input
              name="email"
              type="email"
              required
              value={form.email}
              onChange={handleChange}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">טלפון</label>
            <input
              name="phone_number"
              type="tel"
              value={form.phone_number}
              onChange={handleChange}
              placeholder="050-0000000"
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">סיסמה</label>
            <input
              name="password"
              type="password"
              required
              minLength={6}
              value={form.password}
              onChange={handleChange}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-court"
            />
          </div>

          <label className="flex items-start gap-2 text-sm text-ink mt-2">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-court"
            />
            <span>
              קראתי ואני מסכים{" "}
              <a
                href="/terms.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="text-court underline hover:text-court-dark"
              >
                לתנאי התקנון
              </a>
            </span>
          </label>

          <button
            type="submit"
            disabled={loading || !accepted}
            className="w-full bg-court text-white py-2 rounded-lg hover:bg-court-dark transition disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading ? "נרשם..." : "הרשם"}
          </button>
        </form>

        <p className="text-center text-sm text-muted mt-4">
          כבר רשום?{" "}
          <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="text-court hover:underline">
            כניסה
          </Link>
        </p>
      </div>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<main className="min-h-screen flex items-center justify-center bg-mint"><p className="text-muted">טוען...</p></main>}>
      <RegisterForm />
    </Suspense>
  );
}
