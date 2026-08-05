import Link from "next/link";
import HeroSearch from "@/components/HeroSearch";

const features = [
  { icon: "⚡", title: "הזמנה מהירה", text: "בחירת מגרש, שעה ותשלום בכמה קליקים, בלי טלפונים." },
  { icon: "🎟️", title: "כרטיסיות", text: "חסכו עם כרטיסייה למגרש או למועדון וניצול לפי שעות." },
  { icon: "🔒", title: "תשלום מאובטח", text: "תשלום בכרטיס אשראי דרך שער סליקה מאובטח, בביטחון מלא." },
  { icon: "📅", title: "ניהול הזמנות", text: "צפייה, שינוי וביטול הזמנות עתידיות בקלות מהאזור האישי." },
  { icon: "💬", title: "עוזר חכם", text: "שאלו את העוזר החכם וקבלו מגרש מתאים ישירות בצ'אט." },
];

const steps = [
  { n: "1", title: "בחרו אזור ושעה", text: "הזינו את האזור, התאריך וטווח השעות שמתאים לכם." },
  { n: "2", title: "בחרו מגרש פנוי", text: "קבלו רשימת מגרשים זמינים והשוו מחירים ומועדונים." },
  { n: "3", title: "שלמו והזמינו", text: "תשלום בכרטיס אשראי או בכרטיסייה — ואישור מיידי." },
];

export default function Home() {
  return (
    <main>
      {/* HERO — court search */}
      <section>
        <div className="mx-auto max-w-6xl px-5 pt-14 pb-12">
          <HeroSearch />
        </div>
      </section>

      {/* FEATURES */}
      <section className="mx-auto max-w-6xl px-5 py-14">
        <h2 className="text-center text-2xl font-extrabold tracking-tight sm:text-3xl">כל מה שצריך כדי לשחק</h2>
        <p className="mx-auto mb-8 mt-2 max-w-[52ch] text-center text-[17px] text-muted">
          מהחיפוש ועד הכניסה למגרש — BACO מנהל את הכול עבורכם.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {features.map((f) => (
            <div key={f.title} className="rounded-2xl border border-line bg-surface p-6 transition-shadow hover:shadow-card">
              <div className="mb-3.5 grid h-12 w-12 place-items-center rounded-xl bg-mint text-2xl">{f.icon}</div>
              <h3 className="mb-1.5 text-lg font-extrabold">{f.title}</h3>
              <p className="text-[15px] leading-relaxed text-muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="bg-mint">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <h2 className="text-center text-2xl font-extrabold tracking-tight sm:text-3xl">איך זה עובד</h2>
          <p className="mx-auto mb-8 mt-2 max-w-[52ch] text-center text-[17px] text-muted">שלושה צעדים מהחיפוש עד המגרש.</p>
          <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="flex gap-4 text-right sm:block sm:text-center">
                <div className="grid shrink-0 place-items-center rounded-full bg-court text-2xl font-extrabold text-white sm:mx-auto sm:mb-3.5" style={{ height: 52, width: 52 }}>{s.n}</div>
                <div>
                  <h4 className="mb-1 text-lg font-extrabold">{s.title}</h4>
                  <p className="mx-auto max-w-[26ch] text-[15px] leading-relaxed text-muted">{s.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-5 px-5 py-10">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-ball.png" alt="BACO" className="h-11 w-11" width={44} height={44} />
            <span className="text-sm font-semibold text-muted">הזמנת מגרשי טניס בקלות ובמהירות</span>
          </div>
          <nav className="flex flex-wrap gap-5 text-sm font-semibold text-muted">
            <Link href="/search" className="hover:text-court">מגרשים</Link>
            <Link href="/tickets" className="hover:text-court">כרטיסיות</Link>
            <Link href="/my-bookings" className="hover:text-court">ההזמנות שלי</Link>
            <Link href="/contact" className="hover:text-court">צור קשר</Link>
            <Link href="/privacy" className="hover:text-court">מדיניות פרטיות</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
