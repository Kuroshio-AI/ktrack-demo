import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { BRAND } from "@/lib/client";

// Self-hosted so every device renders the same typeface instead of a local fallback.
const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex" });

export const metadata: Metadata = {
  title: "KTrack · Operations Console",
  description: `KTrack (Kuroshio Track): a local-first ${BRAND.name} operations demo.`,
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={plex.variable}><body>{children}</body></html>;
}
