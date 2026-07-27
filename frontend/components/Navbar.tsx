"use client";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { User, ChevronDown } from "lucide-react";
import api from "@/lib/api";

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [loggedIn, setLoggedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userName, setUserName] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    setLoggedIn(!!token);
    setAdminOpen(false);
    setUserOpen(false);
    setMenuOpen(false);
    if (token) {
      api.get("/users/me")
        .then(r => {
          setIsAdmin(!!r.data.is_admin);
          setUserName(r.data.first_name || r.data.username || "החשבון שלי");
        })
        .catch(() => { setIsAdmin(false); setUserName(""); });
    } else {
      setIsAdmin(false);
      setUserName("");
    }
  }, [pathname]);

  function closeMenus() {
    setMenuOpen(false);
    setAdminOpen(false);
    setUserOpen(false);
  }

  function logout() {
    closeMenus();
    localStorage.removeItem("access_token");
    setIsAdmin(false);
    setUserName("");
    router.push("/login");
  }

  const linkCls = "py-1 text-sm font-semibold text-muted hover:text-court transition-colors";
  const itemCls = "py-1.5 text-right sm:px-4 text-sm text-ink hover:text-court sm:hover:bg-mint";

  return (
    <nav className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur">
      <div className="mx-auto max-w-6xl px-5 flex items-center justify-between h-16">
        <Link href="/" onClick={closeMenus} className="flex items-center gap-2 shrink-0" aria-label="BACO — דף הבית">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-ball.png" alt="BACO" className="h-12 w-12" width={48} height={48} />
        </Link>

        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="sm:hidden p-2 text-court-dark text-xl leading-none"
          aria-label="תפריט"
          aria-expanded={menuOpen}
        >
          ☰
        </button>

        <div className={`${menuOpen ? "flex" : "hidden"} sm:flex flex-col sm:flex-row absolute sm:static top-16 right-0 left-0 bg-canvas sm:bg-transparent border-b border-line sm:border-0 z-50 sm:items-center gap-3 sm:gap-7 px-5 sm:px-0 py-4 sm:py-0`}>
          <Link href="/" onClick={closeMenus} className={linkCls}>חיפוש מגרש</Link>
          {loggedIn ? (
            <>
              <Link href="/contact" onClick={closeMenus} className={linkCls}>צור קשר</Link>

              {isAdmin && (
                <div className="relative">
                  <button
                    onClick={() => { setAdminOpen(o => !o); setUserOpen(false); }}
                    className="py-1 text-sm font-bold text-court-dark hover:text-court flex items-center gap-1"
                    aria-expanded={adminOpen}
                  >
                    ניהול <ChevronDown size={13} />
                  </button>
                  {adminOpen && (
                    <div className="flex flex-col z-50 pr-3 sm:pr-0 sm:absolute sm:top-9 sm:right-0 sm:min-w-[180px] sm:bg-surface sm:rounded-xl sm:shadow-card sm:border sm:border-line sm:py-1.5">
                      <Link href="/admin" onClick={closeMenus} className={itemCls}>ניהול הזמנות</Link>
                      <Link href="/admin/schedule" onClick={closeMenus} className={itemCls}>עריכת לוח זמנים</Link>
                      <Link href="/admin/holidays" onClick={closeMenus} className={itemCls}>ימי חג / סגירה</Link>
                      <Link href="/admin/permissions" onClick={closeMenus} className={itemCls}>ניהול הרשאות</Link>
                    </div>
                  )}
                </div>
              )}

              {/* user account dropdown */}
              <div className="relative">
                <button
                  onClick={() => { setUserOpen(o => !o); setAdminOpen(false); }}
                  className="flex items-center gap-1.5 py-1 text-sm font-bold text-court-dark hover:text-court"
                  aria-expanded={userOpen}
                >
                  <span className="grid place-items-center h-7 w-7 rounded-full bg-mint text-court-dark">
                    <User size={16} />
                  </span>
                  <span className="max-w-[120px] truncate">{userName || "החשבון שלי"}</span>
                  <ChevronDown size={13} />
                </button>
                {userOpen && (
                  <div className="flex flex-col z-50 pr-3 sm:pr-0 sm:absolute sm:top-11 sm:left-0 sm:right-auto sm:min-w-[190px] sm:bg-surface sm:rounded-xl sm:shadow-card sm:border sm:border-line sm:py-1.5">
                    <Link href="/my-bookings" onClick={closeMenus} className={itemCls}>ההזמנות שלי</Link>
                    <Link href="/tickets" onClick={closeMenus} className={itemCls}>כרטיסיות</Link>
                    <Link href="/profile" onClick={closeMenus} className={itemCls}>עדכון פרטים</Link>
                    <div className="my-1 border-t border-line sm:mx-2" />
                    <button onClick={logout} className="py-1.5 text-right sm:px-4 text-sm font-semibold text-red-600 hover:bg-mint">
                      התנתק
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 sm:gap-3">
              <Link href="/login" onClick={closeMenus} className="py-2 px-3 text-sm font-bold text-court-dark hover:text-court">כניסה</Link>
              <Link href="/register" onClick={closeMenus} className="py-2 px-4 text-sm font-bold rounded-xl bg-court text-white hover:bg-court-dark transition-colors">הרשמה</Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
