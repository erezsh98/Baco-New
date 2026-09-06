import type { Metadata, Viewport } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import InstallHint from "@/components/InstallHint";

export const metadata: Metadata = {
  metadataBase: new URL("http://baco.co.il"),
  title: "BACO — הזמנת מגרשי טניס אונליין",
  description: "מצאו מגרש טניס פנוי לפי אזור, תאריך ושעה, והזמינו בשניות. BACO — Book A Court Online.",
  applicationName: "BACO",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,          // launch full-screen (standalone) when added to the iOS home screen
    title: "BACO",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#47800F",     // court green — colors the mobile status/title bar
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="font-sans bg-canvas text-ink">
        <Navbar />
        {children}
        <InstallHint />
      </body>
    </html>
  );
}
