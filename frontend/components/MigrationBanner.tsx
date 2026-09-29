"use client";
import { useState, useEffect } from "react";

// One-time "we moved" notice. Shows through 31-Dec-2026 (Israel time, IST = +02:00
// in winter), then auto-hides. The check runs client-side on every visit, so it
// expires on its own with no redeploy — and the home page can stay statically
// prerendered. Dismissible per browser via localStorage.
const SHOW_UNTIL = new Date("2027-01-01T00:00:00+02:00");
const DISMISS_KEY = "migration_banner_dismissed";

export default function MigrationBanner() {
  // Start hidden so server render and first client render match (no hydration
  // mismatch); decide on mount, where localStorage/Date are available.
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (Date.now() >= SHOW_UNTIL.getTime()) return;   // past the end date → never show
    let dismissed = false;
    try { dismissed = localStorage.getItem(DISMISS_KEY) === "1"; } catch { /* storage blocked */ }
    if (!dismissed) setShow(true);
  }, []);

  if (!show) return null;

  function dismiss() {
    setShow(false);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* storage blocked */ }
  }

  return (
    <div className="bg-court text-white">
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-5 py-3">
        <p className="flex-1 text-[14.5px] leading-relaxed">
          עברנו לאתר חדש! כל הנתונים האישיים הועברו מהאתר הקודם. אם נתקלתם בבעיה, פנו אלינו.
        </p>
        <button
          onClick={dismiss}
          aria-label="סגור הודעה"
          className="shrink-0 rounded p-1 text-lg leading-none text-white/90 transition hover:bg-white/15"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
