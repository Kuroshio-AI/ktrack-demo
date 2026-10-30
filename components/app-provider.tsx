"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createInitialState, recalculateAlerts, setDemoDate as setDate, setRole as setCurrentRole, todayString } from "@/lib/domain";
import { deliver, enqueue, loadOutbox, saveOutbox, statusChanges, type OutboxItem } from "@/lib/outbox";
import { commitState, freshState, loadState } from "@/lib/storage";
import { WHATSAPP_COOLDOWN_MS } from "@/lib/whatsapp";
import type { AppState, Role } from "@/lib/types";

type AppContextValue = {
  state: AppState;
  hydrated: boolean;
  storageWarning?: string;
  saveError?: string;
  update: (updater: (state: AppState) => AppState) => boolean;
  setRole: (role: Role) => void;
  setDemoDate: (date: string) => void;
  clearOperationalData: () => boolean;
  restore: (next: AppState) => boolean;
  // What waits for the connection, and how much the last reconnect sent.
  outbox: OutboxItem[];
  queue: (item: OutboxItem) => void;
  lastSync?: { count: number; at: number };
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => createInitialState(todayString()));
  const latestState = useRef(state);
  const [hydrated, setHydrated] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const outboxRef = useRef<OutboxItem[]>([]);
  const [lastSync, setLastSync] = useState<{ count: number; at: number }>();
  const flushing = useRef(false);
  const updateRef = useRef<(updater: (current: AppState) => AppState) => boolean>(() => false);

  useEffect(() => {
    try {
      const loaded = loadState(window.localStorage, todayString());
      latestState.current = loaded.state;
      setState(loaded.state);
      setStorageWarning(loaded.error);
      outboxRef.current = loadOutbox(window.localStorage);
      setOutbox(outboxRef.current);
    } catch { setStorageWarning("Browser storage is unavailable. Enable local storage to use the demo."); }
    finally { setHydrated(true); }
  }, []);

  const keepOutbox = useCallback((items: OutboxItem[]) => {
    outboxRef.current = items;
    setOutbox(items);
    try { saveOutbox(window.localStorage, items); } catch { /* still held in memory until this tab closes */ }
  }, []);
  // Sends what waits, oldest first, and stops at the first item the connection can't take. The server allows one
  // WhatsApp message every 3 seconds, so queued alerts go out that far apart.
  const flush = useCallback(async () => {
    if (flushing.current || !navigator.onLine || !outboxRef.current.length) return;
    flushing.current = true;
    let count = 0;
    let lastWhatsApp = 0;
    try {
      while (outboxRef.current.length && navigator.onLine) {
        const item = outboxRef.current[0];
        if (item.kind === "alert" && item.whatsapp) await new Promise((resolve) => setTimeout(resolve, Math.max(0, lastWhatsApp + WHATSAPP_COOLDOWN_MS - Date.now())));
        const result = await deliver(item, latestState.current);
        const sent = result.sent;
        if (sent?.whatsapp) lastWhatsApp = Date.now();
        if (sent && (sent.email || sent.whatsapp)) updateRef.current((current) => ({ ...current, alerts: current.alerts.map((alert) => alert.id === sent.alertId ? { ...alert, emailSentAt: alert.emailSentAt ?? sent.email, whatsappSentAt: alert.whatsappSentAt ?? sent.whatsapp } : alert) }));
        if (result.error) setSaveError(result.error);
        const rest = outboxRef.current.filter((other) => other !== item);
        if (result.left) { keepOutbox([result.left, ...rest]); break; }
        keepOutbox(rest);
        count += 1;
      }
    } finally {
      flushing.current = false;
      if (count) setLastSync({ count, at: Date.now() });
    }
  }, [keepOutbox]);
  const queue = useCallback((item: OutboxItem) => { keepOutbox(enqueue(outboxRef.current, item)); void flush(); }, [keepOutbox, flush]);
  useEffect(() => {
    if (!hydrated) return;
    const send = () => void flush();
    send();
    window.addEventListener("online", send);
    // The browser can say online while nothing gets through (Wi-Fi with no internet), so what waits is retried too.
    const retry = setInterval(send, 30_000);
    return () => { window.removeEventListener("online", send); clearInterval(retry); };
  }, [hydrated, flush]);

  const update = useCallback((updater: (current: AppState) => AppState): boolean => {
    if (!hydrated) { setSaveError("KTrack is still restoring this browser workspace."); return false; }
    if (storageWarning) { setSaveError("Storage recovery is required before normal changes can be saved."); return false; }
    try {
      const next = recalculateAlerts(updater(latestState.current));
      const result = commitState(window.localStorage, next);
      if (!result.ok) { setSaveError(result.error); return false; }
      setSaveError(undefined);
      // QR codes read a report's status live, so a revoke or supersede has to reach the server, now or once online.
      const changes = statusChanges(latestState.current, next);
      latestState.current = next;
      setState(next);
      if (changes.length) { keepOutbox(changes.reduce(enqueue, outboxRef.current)); void flush(); }
      return true;
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Change could not be saved. Previous data is intact."); return false; }
  }, [hydrated, storageWarning, keepOutbox, flush]);
  useEffect(() => { updateRef.current = update; }, [update]);

  const setRole = useCallback((role: Role) => { update((current) => setCurrentRole(current, role)); }, [update]);
  const setDemoDate = useCallback((date: string) => { update((current) => setDate(current, date)); }, [update]);
  // Replaces the whole workspace, even during storage recovery: used by Reset demo and Restore backup.
  const restore = useCallback((next: AppState) => {
    try {
      const result = commitState(window.localStorage, next);
      if (!result.ok) { setSaveError(result.error); return false; }
      latestState.current = next;
      setState(next);
      setStorageWarning(undefined);
      setSaveError(undefined);
      return true;
    } catch { setSaveError("Browser storage is unavailable. Previous data is intact."); return false; }
  }, []);
  const clearOperationalData = useCallback(() => restore(freshState(todayString())), [restore]);

  const value = useMemo(() => ({ state, hydrated, storageWarning, saveError, update, setRole, setDemoDate, clearOperationalData, restore, outbox, queue, lastSync }), [state, hydrated, storageWarning, saveError, update, setRole, setDemoDate, clearOperationalData, restore, outbox, queue, lastSync]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
