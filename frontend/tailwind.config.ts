import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // BACO brand palette — greens sampled from the logo
        court: {
          DEFAULT: "#47800F",
          dark: "#2F5809",
          bright: "#4E8A14",
          olive: "#66852A",
        },
        mint: "#EDF5DD",
        lime: "#C7E44F",
        ink: "#18260F",
        muted: "#5E6B4C",
        line: "#E7EFD8",
        canvas: "#FBFCF4",
        surface: "#FFFFFF",
      },
      fontFamily: {
        sans: ['"Assistant"', '"Heebo"', '"Rubik"', '"Segoe UI"', "system-ui", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "0 16px 36px -22px rgba(47,88,9,0.35)",
        float: "0 24px 60px -24px rgba(47,88,9,0.28)",
      },
    },
  },
  plugins: [],
};

export default config;
