import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-green-50 p-8">
      <div className="text-center mb-8">
        <div className="text-6xl mb-4">🎾</div>
        <h1 className="text-4xl font-bold text-green-800 mb-2">TennisLine</h1>
        <p className="text-lg text-gray-600">הזמנת מגרשי טניס בקלות ובמהירות</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-md">
        <Link href="/search"
          className="bg-green-700 text-white px-6 py-4 rounded-xl hover:bg-green-800 transition text-center font-semibold col-span-2">
          🔍 חפש מגרש
        </Link>
        <Link href="/my-bookings"
          className="border-2 border-green-700 text-green-700 px-6 py-4 rounded-xl hover:bg-green-50 transition text-center">
          📅 ההזמנות שלי
        </Link>
        <Link href="/tickets"
          className="border-2 border-green-700 text-green-700 px-6 py-4 rounded-xl hover:bg-green-50 transition text-center">
          🎟️ הכרטיסיות שלי
        </Link>
        <Link href="/contact"
          className="border border-gray-300 text-gray-600 px-6 py-3 rounded-xl hover:bg-gray-50 transition text-center text-sm">
          💬 צור קשר
        </Link>
        <Link href="/login"
          className="border border-gray-300 text-gray-600 px-6 py-3 rounded-xl hover:bg-gray-50 transition text-center text-sm">
          כניסה / הרשמה
        </Link>
      </div>
    </main>
  );
}
