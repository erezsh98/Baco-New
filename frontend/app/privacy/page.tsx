import Link from "next/link";

export const metadata = {
  title: "מדיניות פרטיות — BACO",
  description: "מדיניות הפרטיות של BACO — איזה מידע נאסף, כיצד נעשה בו שימוש, וזכויותיכם.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-xl font-extrabold text-court-dark">{title}</h2>
      <div className="space-y-2 text-[15.5px] leading-relaxed text-ink/90">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-3xl font-extrabold tracking-tight text-court-dark">מדיניות פרטיות</h1>
        <p className="mt-2 text-sm text-muted">עודכן לאחרונה: 30 ביולי 2026</p>

        <p className="mt-6 text-[15.5px] leading-relaxed text-ink/90">
          מדיניות זו מסבירה איזה מידע BACO (&quot;באקו&quot; — שירות להזמנת מגרשי טניס אונליין, להלן &quot;השירות&quot;, &quot;אנחנו&quot;)
          אוסף עליכם, כיצד אנו עושים בו שימוש, עם מי הוא משותף, וכיצד תוכלו לממש את זכויותיכם. השימוש בשירות מהווה
          הסכמה למדיניות זו.
        </p>

        <Section title="1. מי אנחנו">
          <p>
            BACO מפעילה אתר ואפליקציה להזמנת מגרשי טניס ומועדונים, רכישת כרטיסיות וניהול הזמנות.
            בעל השירות: <span className="font-semibold">[שם החברה / העוסק המורשה]</span>, <span className="font-semibold">[כתובת]</span>.
          </p>
        </Section>

        <Section title="2. איזה מידע אנו אוספים">
          <ul className="list-disc pr-5 space-y-1">
            <li><span className="font-semibold">מידע שאתם מוסרים בהרשמה:</span> שם פרטי, שם משפחה, כתובת דוא&quot;ל, מספר טלפון וסיסמה (הסיסמה נשמרת מוצפנת בלבד).</li>
            <li><span className="font-semibold">מידע על הזמנות ושימוש:</span> מגרשים שהזמנתם, מועדון, תאריך ושעה, אמצעי תשלום (אשראי או כרטיסייה), כרטיסיות ויתרתן, והיסטוריית הזמנות.</li>
            <li><span className="font-semibold">פניות ותמיכה:</span> תוכן הודעות שאתם שולחים בטופס &quot;צור קשר&quot; או לעוזר החכם (צ&#39;אט).</li>
            <li><span className="font-semibold">מידע טכני בסיסי:</span> נתונים הנחוצים לאבטחה ולתפעול תקין של השירות.</li>
          </ul>
        </Section>

        <Section title="3. אחסון בדפדפן ועוגיות (Cookies)">
          <p>
            אנו משתמשים ב&#8209;<span className="font-semibold">אחסון מקומי בדפדפן (localStorage)</span> כדי לשמור אסימון התחברות (טוקן)
            ופרטי הזמנה זמניים במהלך תהליך ההזמנה. אחסון זה <span className="font-semibold">חיוני לתפקוד השירות</span> (כניסה למערכת
            והשלמת הזמנה) ואינו משמש למעקב או פרסום.
          </p>
          <p>
            איננו עושים שימוש בעוגיות או בכלי מעקב לצרכי פרסום, פרסום מותאם או ניתוח סטטיסטי (כגון Google Analytics, פיקסלים שיווקיים וכד&#39;).
          </p>
          <p>
            בעת ביצוע תשלום, ספק הסליקה (Pelecard) עשוי לעשות שימוש בעוגיות משלו בסביבת התשלום המאובטחת שלו, לצורך ביצוע העסקה בלבד.
          </p>
        </Section>

        <Section title="4. כיצד אנו משתמשים במידע">
          <ul className="list-disc pr-5 space-y-1">
            <li>ניהול חשבון המשתמש והתחברות מאובטחת.</li>
            <li>ביצוע, ניהול, שינוי וביטול הזמנות וכרטיסיות.</li>
            <li>עיבוד תשלומים באמצעות ספק סליקה חיצוני.</li>
            <li>שליחת אישורי הזמנה, תזכורות והודעות שירות בדוא&quot;ל וב&#8209;SMS, וקבלת קוד כניסה לשער המגרש.</li>
            <li>מתן מענה לפניות ותמיכה, ושיפור השירות.</li>
          </ul>
        </Section>

        <Section title="5. שיתוף מידע עם צדדים שלישיים">
          <p>איננו מוכרים את המידע שלכם. אנו משתפים מידע רק עם ספקי שירות הנדרשים לתפעול השירות, ובהיקף הנחוץ בלבד:</p>
          <ul className="list-disc pr-5 space-y-1">
            <li><span className="font-semibold">Pelecard</span> — סליקת כרטיסי אשראי.</li>
            <li><span className="font-semibold">019 (ספק SMS)</span> — שליחת הודעות טקסט וקודי כניסה לשער.</li>
            <li><span className="font-semibold">שירות דוא&quot;ל</span> — שליחת אישורים והודעות שירות.</li>
            <li><span className="font-semibold">Anthropic (Claude)</span> — הודעות שאתם כותבים לעוזר החכם נשלחות לעיבוד לצורך מתן מענה. אנא הימנעו משיתוף מידע רגיש בצ&#39;אט.</li>
          </ul>
          <p>כמו כן, ייתכן שנעביר מידע אם נידרש לכך על פי דין או צו שיפוטי.</p>
        </Section>

        <Section title="6. אבטחת מידע">
          <p>
            אנו נוקטים באמצעים סבירים לאבטחת המידע: סיסמאות נשמרות בצורה מוצפנת (hashing), התקשורת מוצפנת,
            והתשלום מתבצע דרך שער סליקה מאובטח. עם זאת, אין אבטחה מושלמת, ואיננו יכולים להבטיח הגנה מוחלטת.
          </p>
        </Section>

        <Section title="7. שמירת המידע">
          <p>
            אנו שומרים את המידע כל עוד חשבונכם פעיל ובמידה הנדרשת למתן השירות ולעמידה בחובות חוקיות
            (כגון חובות חשבונאיות ומיסוי). ניתן לבקש מחיקה בכפוף למגבלות הדין.
          </p>
        </Section>

        <Section title="8. הזכויות שלכם">
          <ul className="list-disc pr-5 space-y-1">
            <li>עיון ועדכון של פרטיכם דרך עמוד <Link href="/profile" className="font-semibold text-court hover:underline">עדכון פרטים</Link>.</li>
            <li>בקשה למחיקת חשבון ומידע אישי, בכפוף למגבלות הדין.</li>
            <li>הסרה מרשימת הודעות שירות/דיוור.</li>
          </ul>
          <p>למימוש זכויות אלו פנו אלינו בפרטים שבהמשך.</p>
        </Section>

        <Section title="9. שינויים במדיניות">
          <p>
            אנו עשויים לעדכן מדיניות זו מעת לעת. עדכונים מהותיים יפורסמו בעמוד זה עם תאריך עדכון מעודכן.
          </p>
        </Section>

        <Section title="10. יצירת קשר">
          <p>
            בכל שאלה או בקשה בנוגע לפרטיות, ניתן לפנות אלינו בדוא&quot;ל <span className="font-semibold">[service@baco.co.il]</span>
            {" "}או דרך עמוד <Link href="/contact" className="font-semibold text-court hover:underline">צור קשר</Link>.
          </p>
        </Section>

        <div className="mt-12 border-t border-line pt-6">
          <Link href="/" className="text-sm font-semibold text-court hover:underline">← חזרה לעמוד הבית</Link>
        </div>
      </div>
    </main>
  );
}
