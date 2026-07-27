import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";

export const metadata: Metadata = {
  title: "BACO — הזמנת מגרשי טניס אונליין",
  description: "מצאו מגרש טניס פנוי לפי אזור, תאריך ושעה, והזמינו בשניות. BACO — Book A Court Online.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="font-sans bg-canvas text-ink">
        <Navbar />
        {children}
      </body>
    </html>
  );
}
