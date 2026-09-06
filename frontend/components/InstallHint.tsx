"use client";
import { useEffect, useState } from "react";
import { X, Share, MoreVertical, Download } from "lucide-react";

const DISMISS_KEY = "baco_install_hint_dismissed";

// Chrome's install event, fired on Android when the app is installable.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Dismissible hint that helps mobile users install BACO to their home screen.
 * On Android it uses Chrome's native install prompt when offered; otherwise
 * (and always on iOS Safari) it shows the manual "Add to Home Screen" steps.
 * Hidden when already installed (standalone) or previously dismissed.
 */
export default function InstallHint() {
  const [platform, setPlatform] = useState<"ios" | "android" | null>(null);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    try {
      // Already installed → nothing to prompt.
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      if (standalone) return;
      if (localStorage.getItem(DISMISS_KEY)) return;

      const ua = window.navigator.userAgent;
      const isIOS =
        /iphone|ipad|ipod/i.test(ua) ||
        (/macintosh/i.test(ua) && "ontouchend" in document); // iPadOS reports as Mac
      const isAndroid = /android/i.test(ua);
      if (!isIOS && !isAndroid) return; // desktop → skip the hint

      setPlatform(isIOS ? "ios" : "android");
      setVisible(true);
    } catch {
      /* storage/matchMedia unavailable — just don't show the hint */
    }
  }, []);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // stop the default mini-infobar; we drive the prompt from our button
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setVisible(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    setVisible(false);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
  }

  async function onInstallClick() {
    if (deferred) {
      // Native Android prompt available — use it.
      await deferred.prompt();
      const choice = await deferred.userChoice;
      setDeferred(null);
      if (choice.outcome === "accepted") dismiss();
      return;
    }
    // No native prompt (iOS always, or Android without a service worker) → show steps.
    setShowSteps((s) => !s);
  }

  if (!visible || !platform) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4" dir="rtl">
      <div className="mx-auto max-w-md rounded-2xl bg-white shadow-float ring-1 ring-line overflow-hidden">
        <div className="flex items-center gap-3 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="BACO" className="h-10 w-10 rounded-lg" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink">התקינו את BACO לטלפון</p>
            <p className="text-xs text-muted">גישה מהירה ממסך הבית, במסך מלא.</p>
          </div>
          <button
            onClick={onInstallClick}
            className="flex items-center gap-1 bg-court text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-court-dark transition shrink-0"
          >
            <Download size={16} />
            התקנה
          </button>
          <button onClick={dismiss} aria-label="סגור" className="text-muted hover:text-ink shrink-0">
            <X size={18} />
          </button>
        </div>

        {showSteps && (
          <div className="border-t border-line bg-mint px-4 py-3 text-sm text-ink">
            {platform === "ios" ? (
              <p className="flex items-center gap-1.5 flex-wrap">
                <span>בספארי: הקישו על</span>
                <Share size={16} className="text-court inline" />
                <span>(שיתוף) ואז על <strong>"הוספה למסך הבית"</strong>.</span>
              </p>
            ) : (
              <p className="flex items-center gap-1.5 flex-wrap">
                <span>פתחו את תפריט הדפדפן</span>
                <MoreVertical size={16} className="text-court inline" />
                <span>ובחרו <strong>"התקנת אפליקציה"</strong> או <strong>"הוספה למסך הבית"</strong>.</span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
