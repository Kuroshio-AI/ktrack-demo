import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";
import { IS_AMS, IS_FLS, IS_GEX } from "@/lib/client";
import "./globals.css";

// Self-hosted so every device renders the same typeface instead of a local fallback.
const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex" });
// AMS tally readings and report figures: Plex's monospace, so every column of inches lines up.
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });
// GEX certificate: only its title, stamp and status overprint, where a document face reads as official.
const plexSerif = IBM_Plex_Serif({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-plex-serif" });

export const metadata: Metadata = {
  title: IS_FLS ? "KTrack · FLS Certificate Tracker" : IS_GEX ? "KTrack · Quality Certificates" : IS_AMS ? "KTrack · Drill Pipe Inspection" : "KTrack · Operations Console",
  description: IS_FLS ? "KTrack (Kuroshio Track): a local-first FLS DCD certificate tracker demo." : IS_GEX ? "KTrack (Kuroshio Track): production lots checked against alloy limits and issued as quality certificates with a QR." : IS_AMS ? "KTrack (Kuroshio Track): drill pipe tally sheets checked against the dimension table, issued as inspection reports." : "KTrack (Kuroshio Track): a local-first Kee Safety operations demo.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg", apple: "/icons/apple-icon.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${plex.variable} ${plexMono.variable} ${plexSerif.variable}`}><body>{children}</body></html>;
}
