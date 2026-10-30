"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AlertTriangle, CloudUpload, Download, WifiOff } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { itemLabel, syncKey } from "@/lib/sync";

// KTrack as an installed app: the Install button, the service worker (public/sw.js) that lets it open with no internet,
// and the banner that says what waits for the connection. Readings never wait: they are saved on the laptop as typed.

const subscribeOnline = (callback: () => void) => {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => { window.removeEventListener("online", callback); window.removeEventListener("offline", callback); };
};
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

// Registers the service worker and hands it the menu's pages plus every build file this page loaded, so the next visit
// opens with no internet. A new deploy brings a new worker, which takes over and is handed the list again. Development
// skips it: a cached dev bundle would fight hot reload.
export function useServiceWorker(pages: string[]) {
  const list = pages.join(" ");
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const urls = () => [...list.split(" "), "/manifest.webmanifest", "/icon.svg", ...performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => name.startsWith(`${location.origin}/_next/static/`))];
    const precache = () => navigator.serviceWorker.controller?.postMessage({ type: "precache", urls: urls() });
    navigator.serviceWorker.addEventListener("controllerchange", precache);
    navigator.serviceWorker.register(`/sw.js?v=${process.env.KTRACK_BUILD_ID}`, { scope: "/", updateViaCache: "none" })
      .then(async () => (navigator.serviceWorker.controller ?? (await navigator.serviceWorker.ready).active)?.postMessage({ type: "precache", urls: urls() }))
      .catch(() => undefined);
    // Asks the browser not to clear this site's storage when the disk runs low; installed apps are usually granted it.
    void navigator.storage?.persist?.();
    return () => navigator.serviceWorker.removeEventListener("controllerchange", precache);
  }, [list]);
}

// Chrome and Edge offer installing once the page qualifies; the offer is kept for the button. Safari has no such event:
// there it is File > Add to Dock, or Share > Add to Home Screen on an iPad.
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
let installPrompt: InstallPrompt | undefined;
const promptListeners = new Set<() => void>();
const setInstallPrompt = (next: InstallPrompt | undefined) => { installPrompt = next; promptListeners.forEach((listener) => listener()); };
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt); });
  window.addEventListener("appinstalled", () => setInstallPrompt(undefined));
}
const subscribePrompt = (callback: () => void) => { promptListeners.add(callback); return () => { promptListeners.delete(callback); }; };

export function InstallButton() {
  const prompt = useSyncExternalStore(subscribePrompt, () => installPrompt, () => undefined);
  if (!prompt) return null;
  // The browser's offer works once, whatever the answer.
  const install = async () => { await prompt.prompt(); await prompt.userChoice; setInstallPrompt(undefined); };
  return <Button variant="ghost" className="press mx-2 mb-4 justify-start border border-[#467493] bg-[#123e60] text-white hover:bg-[#18496f] hover:text-white" onClick={() => void install()}>
    <Download data-icon="inline-start" aria-hidden="true" />Install KTrack<span className="ml-auto text-[11px] font-medium text-[#9cbed2]">Works offline</span>
  </Button>;
}

const updates = (count: number) => `${count} update${count === 1 ? "" : "s"}`;

export function OfflineBanner() {
  const online = useOnline();
  const { outbox: queued, lastSync, conflicts } = useApp();
  // A change held back by a conflict isn't on its way; the conflict notice below covers it.
  const outbox = queued.filter((item) => item.kind !== "sync" || !conflicts.some((row) => row.kind === item.item && row.id === item.id));
  // "Sent" shows for 6 seconds after a reconnect empties the outbox, and only after the laptop really was offline.
  const [seen, setSeen] = useState<number>();
  const [wasOffline, setWasOffline] = useState(false);
  useEffect(() => {
    if (!lastSync) return;
    const timer = setTimeout(() => setSeen(lastSync.at), 6_000);
    return () => clearTimeout(timer);
  }, [lastSync]);
  const sent = lastSync && lastSync.at !== seen && !outbox.length ? lastSync.count : 0;
  if (!online && !wasOffline) setWasOffline(true);
  if (online && wasOffline && !outbox.length && !sent) setWasOffline(false);

  if (!online) return <div role="status" className="animate-rise mb-5 flex gap-3 rounded-lg border border-[#b8cedc] bg-[#eef5f9] px-4 py-3 text-sm text-navy">
    <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
    <p><b>You&apos;re offline.</b> Everything you enter is saved on this laptop. {outbox.length ? `${updates(outbox.length)} ${outbox.length === 1 ? "waits" : "wait"} for the connection and ${outbox.length === 1 ? "goes" : "go"} out by ${outbox.length === 1 ? "itself" : "themselves"} when it's back.` : "Report QR codes and alerts wait for the connection."}</p>
  </div>;
  if (wasOffline && (outbox.length || sent)) return <div role="status" className="animate-rise mb-5 flex gap-3 rounded-lg border border-success/25 bg-success/[.06] px-4 py-3 text-sm text-navy">
    <CloudUpload className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
    <p><b>Back online.</b> {outbox.length ? `Sending ${updates(outbox.length)}…` : `${updates(sent)} sent.`}</p>
  </div>;
  return null;
}

const changedAt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// Trial only: a record changed on this laptop and on another before either synced. Nothing is overwritten until the
// person picks a copy; until then this laptop's change stays here, unsent.
export function SyncConflicts() {
  const { conflicts, resolveConflict, state } = useApp();
  if (!conflicts.length) return null;
  return <div role="alert" className="animate-rise mb-5 rounded-lg border border-warning/30 bg-warning/[.07] px-4 py-3 text-sm text-navy">
    <p className="flex items-center gap-2 font-bold"><AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden="true" />Changed on another laptop too</p>
    <ul className="mt-2 flex flex-col gap-3">
      {conflicts.map((row) => <li key={syncKey(row.kind, row.id)} className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-[240px] flex-1">{itemLabel(state, row.kind, row.id, row.data)} was {row.data === null ? "removed" : "changed"} by <b>{row.updatedBy}</b> on {changedAt.format(new Date(row.updatedAt))}. Your changes to it haven&apos;t been sent.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="press" onClick={() => resolveConflict(row, "theirs")}>Use theirs</Button>
          <Button size="sm" className="press" onClick={() => resolveConflict(row, "mine")}>Keep mine</Button>
        </div>
      </li>)}
    </ul>
  </div>;
}
