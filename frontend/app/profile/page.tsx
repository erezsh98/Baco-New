"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";

export default function ProfilePage() {
  const router = useRouter();
  const [form, setForm] = useState({
    first_name: "", last_name: "", phone_number: "", password: "", confirm: "",
  });
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("access_token")) {
      router.push("/login");
      return;
    }
    api.get("/users/me")
      .then(r => {
        setEmail(r.data.username);
        setForm(f => ({
          ...f,
          first_name: r.data.first_name || "",
          last_name: r.data.last_name || "",
          phone_number: r.data.phone_number || "",
        }));
      })
      .catch(() => setError("שגיאה בטעינת הפרטים"))
      .finally(() => setLoading(false));
  }, []);

  function handle(e: React.ChangeEvent<HTMLInputElement>) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSuccess(false);
    if (form.password && form.password !== form.confirm) {
      setError("הסיסמאות אינן תואמות");
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        first_name: form.first_name,
        last_name: form.last_name,
        phone_number: form.phone_number,
      };
      if (form.password) payload.password = form.password;
      await api.put("/users/me", payload);
      setSuccess(true);
      setForm(f => ({ ...f, password: "", confirm: "" }));
    } catch (err: any) {
      setError(err.response?.data?.detail || "שגיאה בשמירת הפרטים");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="min-h-screen bg-green-50 p-4"><p className="text-center text-gray-500 mt-8">טוען...</p></main>;
  }

  return (
    <main className="min-h-screen bg-green-50 p-4">
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-bold text-green-800 mb-6 text-center">כרטיס אישי</h1>

        <form onSubmit={save} className="bg-white rounded-2xl shadow p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">אימייל</label>
            <input value={email} disabled
              className="w-full border rounded-lg px-3 py-2 bg-gray-100 text-gray-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">שם פרטי</label>
            <input name="first_name" required value={form.first_name} onChange={handle}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">שם משפחה</label>
            <input name="last_name" required value={form.last_name} onChange={handle}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">טלפון</label>
            <input name="phone_number" value={form.phone_number} onChange={handle}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>

          <hr className="my-2" />
          <p className="text-sm text-gray-500">שינוי סיסמה (השאר ריק כדי לא לשנות)</p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">סיסמה חדשה</label>
            <input name="password" type="password" value={form.password} onChange={handle}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">אימות סיסמה</label>
            <input name="confirm" type="password" value={form.confirm} onChange={handle}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
          {success && <p className="text-green-700 text-sm">הפרטים עודכנו בהצלחה!</p>}

          <button type="submit" disabled={saving}
            className="w-full bg-green-700 text-white py-2 rounded-lg hover:bg-green-800 transition disabled:opacity-50">
            {saving ? "שומר..." : "שמור שינויים"}
          </button>
        </form>
      </div>
    </main>
  );
}
