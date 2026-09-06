import type { MetadataRoute } from "next";

// Web app manifest — Next serves this at /manifest.webmanifest. Makes BACO
// installable to the home screen (standalone window, brand icon + colors).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BACO — הזמנת מגרשי טניס",
    short_name: "BACO",
    description: "מצאו מגרש טניס פנוי לפי אזור, תאריך ושעה, והזמינו בשניות.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    dir: "rtl",
    lang: "he",
    background_color: "#FBFCF4", // canvas
    theme_color: "#47800F",      // court green
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
