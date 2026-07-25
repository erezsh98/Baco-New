"use client";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import api from "@/lib/api";

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [loggedIn, setLoggedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    setLoggedIn(!!token);
    setAdminOpen(false);
    if (token) {
      api.get("/users/me")
        .then(r => setIsAdmin(!!r.data.is_admin))
        .catch(() => setIsAdmin(false));
    } else {
      setIsAdmin(false);
    }
  }, [pathname]);

  function closeMenus() {
    setMenuOpen(false);
    setAdminOpen(false);
  }

  function logout() {
    localStorage.removeItem("access_token");
    setIsAdmin(false);
    router.push("/login");
  }

  return (
    <nav className="bg-green-800 text-white shadow-md">
      <div className="max-w-5xl mx-auto px-4 flex items-center justify-between h-14">
        <Link href="/" className="font-bold text-lg tracking-wide">🎾 TennisLine</Link>

        <button onClick={() => setMenuOpen(!menuOpen)} className="sm:hidden p-2">☰</button>

        <div className={`${menuOpen ? "flex" : "hidden"} sm:flex flex-col sm:flex-row absolute sm:static top-14 right-0 left-0 bg-green-800 sm:bg-transparent z-50 sm:items-center gap-2 sm:gap-8 px-4 sm:px-0 pb-4 sm:pb-0`}>
          <Link href="/search" onClick={() => setMenuOpen(false)} className="py-1 hover:text-green-200 text-sm">חיפוש מגרש</Link>
          {loggedIn ? (
            <>
              <Link href="/my-bookings" onClick={() => setMenuOpen(false)} className="py-1 hover:text-green-200 text-sm">ההזמנות שלי</Link>
              <Link href="/tickets" onClick={() => setMenuOpen(false)} className="py-1 hover:text-green-200 text-sm">כרטיסיות</Link>
              <Link href="/profile" onClick={() => setMenuOpen(false)} className="py-1 hover:text-green-200 text-sm">כרטיס אישי</Link>
              <Link href="/contact" onClick={() => setMenuOpen(false)} className="py-1 hover:text-green-200 text-sm">צור קשר</Link>
              {isAdmin && (
                <div className="relative">
                  <button onClick={() => setAdminOpen(o => !o)}
                    className="py-1 text-yellow-300 hover:text-yellow-100 text-sm font-semibold flex items-center gap-1">
                    מנהל <span className="text-[10px]">▾</span>
                  </button>
                  {adminOpen && (
                    <div className="flex flex-col z-50 pr-3 sm:pr-0 sm:absolute sm:top-8 sm:right-0 sm:min-w-[160px] sm:bg-green-900 sm:rounded-lg sm:shadow-lg sm:py-1">
                      <Link href="/admin" onClick={closeMenus} className="py-1 sm:px-4 text-sm text-yellow-100 hover:text-white sm:hover:bg-green-800">ניהול הזמנות</Link>
                      <Link href="/admin/schedule" onClick={closeMenus} className="py-1 sm:px-4 text-sm text-yellow-100 hover:text-white sm:hover:bg-green-800">עריכת לוח זמנים</Link>
                      <Link href="/admin/holidays" onClick={closeMenus} className="py-1 sm:px-4 text-sm text-yellow-100 hover:text-white sm:hover:bg-green-800">ימי חג / סגירה</Link>
                      <Link href="/admin/permissions" onClick={closeMenus} className="py-1 sm:px-4 text-sm text-yellow-100 hover:text-white sm:hover:bg-green-800">ניהול הרשאות</Link>
                    </div>
                  )}
                </div>
              )}
              <button onClick={logout} className="py-1 hover:text-green-200 text-sm">התנתק</button>
            </>
          ) : (
            <>
              <Link href="/login" onClick={() => setMenuOpen(false)} className="py-1 hover:text-green-200 text-sm">כניסה</Link>
              <Link href="/register" onClick={() => setMenuOpen(false)} className="bg-white text-green-800 px-3 py-1 rounded-lg text-sm font-medium hover:bg-green-50">הרשמה</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
