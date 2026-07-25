"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const registered = searchParams.get("registered");
  const reset = searchParams.get("reset");
  const next = searchParams.get("next");

  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post(
        "/auth/login",
        new URLSearchParams({ username: form.username, password: form.password }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );
      localStorage.setItem("access_token", res.data.access_token);
      router.push(next || "/search");
    } catch (err: any) {
      setError(err.response?.data?.detail || "אימייל או סיסמה שגויים");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
      <h1 className="text-2xl font-bold text-green-800 mb-6 text-center">כניסה</h1>

      {registered && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 mb-4 text-sm">
          ההרשמה הצליחה! ניתן להתחבר עכשיו.
        </div>
      )}
      {reset && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 mb-4 text-sm">
          הסיסמה אופסה בהצלחה! אנא התחבר.
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">אימייל</label>
          <input
            name="username"
            type="email"
            required
            value={form.username}
            onChange={handleChange}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">סיסמה</label>
          <input
            name="password"
            type="password"
            required
            value={form.password}
            onChange={handleChange}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-green-700 text-white py-2 rounded-lg hover:bg-green-800 transition disabled:opacity-50 mt-2"
        >
          {loading ? "מתחבר..." : "כניסה"}
        </button>
      </form>

      <p className="text-center text-sm text-gray-500 mt-4">
        עדיין לא רשום?{" "}
        <Link href={next ? `/register?next=${encodeURIComponent(next)}` : "/register"} className="text-green-700 hover:underline">הרשמה</Link>
      </p>
      <p className="text-center text-sm text-gray-500 mt-2">
        <Link href="/reset-password" className="text-green-600 hover:underline text-xs">שכחת סיסמה?</Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-green-50 p-4">
      <Suspense fallback={<div className="text-gray-500">טוען...</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
