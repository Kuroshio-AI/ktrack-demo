import type { MetadataRoute } from "next";
import { AMS_NAME, IS_AMS, IS_FLS } from "@/lib/client";

// Makes KTrack installable from Chrome or Edge: it opens in its own window from the Start menu or the Dock, and the
// service worker (public/sw.js) lets it open and work with no internet.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: IS_AMS ? `KTrack · ${AMS_NAME}` : IS_FLS ? "KTrack · FLS Certificate Tracker" : "KTrack · Operations Console",
    short_name: "KTrack",
    description: IS_AMS ? "Drill pipe tally sheets checked against the dimension table, issued as inspection reports. Works offline." : "KTrack (Kuroshio Track). Works offline.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#0b3151",
    theme_color: "#0b3151",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
