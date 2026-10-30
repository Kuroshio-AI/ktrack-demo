"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IS_TRIAL } from "@/lib/client";
import { createInitialState, recalculateAlerts, setDemoDate as setDate, setRole as setCurrentRole, STORAGE_KEY, todayString } from "@/lib/domain";
import { deliver, enqueue, loadOutbox, OUTBOX_KEY, saveOutbox, statusChanges, type OutboxItem } from "@/lib/outbox";
import { commitState, freshState, loadState } from "@/lib/storage";
import { changedItems, itemData, loadSyncMeta, mergeRows, saveSyncMeta, SYNC_KEY, syncKey, type SyncKind, type SyncRow, type TrialUser } from "@/lib/sync";
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
  // The trial's signed-in account, and records changed here and elsewhere at once, waiting for a choice.
  user?: TrialUser;
  conflicts: SyncRow[];
  resolveConflict: (row: SyncRow, keep: "mine" | "theirs") => void;
  signOut: () => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);
type SyncItem = Extract<OutboxItem, { kind: "sync" }>;
const isSyncItem = (item: OutboxItem): item is SyncItem => item.kind === "sync";
const itemKey = (item: SyncItem) => syncKey(item.item, item.id);
// A customer account reads like a Manager until it has its own pages.
const roleFor = (user: TrialUser): Role => user.role === "Customer" ? "Manager" : user.role;

// The trial opens as the account the server says is signed in, or offline as the last one. "signed-out" goes to sign-in.
async function trialUser(): Promise<TrialUser | "signed-out"> {
  const meta = loadSyncMeta(window.localStorage);
  const response = await fetch("/api/auth/get-session", { cache: "no-store" }).catch(() => undefined);
  if (!response || response.status >= 500) return meta.user ?? "signed-out";
  const session = await response.json().catch(() => null) as { user?: TrialUser } | null;
  const user = session?.user;
  if (!user) return "signed-out";
  // Another account on this laptop starts from an empty workspace, unless both are staff and changes still wait to go up.
  const waiting = loadOutbox(window.localStorage).some(isSyncItem);
  if (meta.user?.id !== user.id && (!waiting || user.role === "Customer" || meta.user?.role === "Customer")) {
    for (const key of [STORAGE_KEY, OUTBOX_KEY]) window.localStorage.removeItem(key);
    saveSyncMeta(window.localStorage, { cursor: 0, versions: {}, user });
  } else saveSyncMeta(window.localStorage, { ...meta, user });
  return user;
}

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
  const syncing = useRef(false);
  const updateRef = useRef<(updater: (current: AppState) => AppState) => boolean>(() => false);
  const [user, setUser] = useState<TrialUser>();
  const [conflicts, setConflicts] = useState<SyncRow[]>([]);
  const conflictsRef = useRef<SyncRow[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const account = IS_TRIAL ? await trialUser() : undefined;
        if (account === "signed-out") { window.location.replace("/sign-in"); return; }
        const loaded = loadState(window.localStorage, todayString());
        // On the trial the date is always today and the role is the account's.
        const opened = account ? recalculateAlerts({ ...loaded.state, demoDate: todayString(), role: roleFor(account) }) : loaded.state;
        latestState.current = opened;
        setState(opened);
        setUser(account);
        setStorageWarning(loaded.error);
        outboxRef.current = loadOutbox(window.localStorage);
        setOutbox(outboxRef.current);
        setHydrated(true);
      } catch { setStorageWarning("Browser storage is unavailable. Enable local storage to use the demo."); setHydrated(true); }
    })();
  }, []);

  const keepOutbox = useCallback((items: OutboxItem[]) => {
    outboxRef.current = items;
    setOutbox(items);
    try { saveOutbox(window.localStorage, items); } catch { /* still held in memory until this tab closes */ }
  }, []);
  const keepConflicts = useCallback((rows: SyncRow[]) => { conflictsRef.current = rows; setConflicts(rows); }, []);
  const commit = useCallback((next: AppState) => {
    if (!commitState(window.localStorage, next).ok) return false;
    latestState.current = next;
    setState(next);
    return true;
  }, []);

  // Sends the waiting record changes, 100 at a time, and takes in what changed on the server since the last sync. A
  // change someone else beat us to is held back until the person picks a copy.
  const sync = useCallback(async () => {
    if (!IS_TRIAL || syncing.current || !navigator.onLine) return;
    syncing.current = true;
    let count = 0;
    try {
      for (let round = 0; round < 50; round += 1) {
        const meta = loadSyncMeta(window.localStorage);
        const held = new Set(conflictsRef.current.map((row) => syncKey(row.kind, row.id)));
        const sent = outboxRef.current.filter(isSyncItem).filter((item) => !held.has(itemKey(item))).slice(0, 100)
          .map((item) => ({ kind: item.item, id: item.id, base: meta.versions[itemKey(item)] ?? 0, data: itemData(latestState.current, item.item, item.id) }));
        const response = await fetch("/api/sync", { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ changes: sent, since: meta.cursor }) }).catch(() => undefined);
        if (!response) return;
        if (response.status === 401) { window.location.replace("/sign-in"); return; }
        const result = await response.json().catch(() => ({ error: "The server didn't answer the sync." })) as { applied?: { kind: SyncKind; id: string; version: number }[]; conflicts?: SyncRow[]; rows?: SyncRow[]; more?: boolean; error?: string };
        if (!response.ok || !result.applied || !result.conflicts || !result.rows) { setSaveError(result.error ?? "Changes couldn't sync. They stay on this laptop and will be tried again."); return; }
        for (const item of result.applied) meta.versions[syncKey(item.kind, item.id)] = item.version;
        // Done unless refused, or changed again while it was on its way (then it goes up again from the new version).
        const conflicted = new Set(result.conflicts.map((row) => syncKey(row.kind, row.id)));
        const sentCopy = new Map(sent.map((change) => [syncKey(change.kind, change.id), JSON.stringify(change.data)]));
        const done = (item: OutboxItem) => isSyncItem(item) && sentCopy.has(itemKey(item)) && !conflicted.has(itemKey(item)) && JSON.stringify(itemData(latestState.current, item.item, item.id)) === sentCopy.get(itemKey(item));
        const before = outboxRef.current.length;
        keepOutbox(outboxRef.current.filter((item) => !done(item)));
        count += before - outboxRef.current.length;
        if (result.conflicts.length) keepConflicts([...conflictsRef.current.filter((row) => !conflicted.has(syncKey(row.kind, row.id))), ...result.conflicts]);
        const waiting = new Set(outboxRef.current.filter(isSyncItem).map(itemKey));
        if (result.rows.length && commit(recalculateAlerts(mergeRows(latestState.current, result.rows, waiting)))) {
          for (const row of result.rows) if (!waiting.has(syncKey(row.kind, row.id))) meta.versions[syncKey(row.kind, row.id)] = row.version;
          meta.cursor = Math.max(meta.cursor, ...result.rows.map((row) => row.seq));
        }
        saveSyncMeta(window.localStorage, meta);
        setSaveError(undefined);
        const unsent = outboxRef.current.filter(isSyncItem).some((item) => !conflictsRef.current.some((row) => syncKey(row.kind, row.id) === itemKey(item)));
        if (!result.more && !(unsent && sent.length)) break;
      }
    } finally {
      syncing.current = false;
      if (count) setLastSync({ count, at: Date.now() });
    }
  }, [keepOutbox, keepConflicts, commit]);

  // Sends what waits, oldest first, and stops at the first item the connection can't take. The server allows one
  // WhatsApp message every 3 seconds, so queued alerts go out that far apart.
  const flush = useCallback(async () => {
    void sync();
    const next = () => outboxRef.current.find((item): item is Exclude<OutboxItem, SyncItem> => !isSyncItem(item));
    if (flushing.current || !navigator.onLine || !next()) return;
    flushing.current = true;
    let count = 0;
    let lastWhatsApp = 0;
    try {
      let item: ReturnType<typeof next>;
      while ((item = next()) && navigator.onLine) {
        const current = item;
        if (current.kind === "alert" && current.whatsapp) await new Promise((resolve) => setTimeout(resolve, Math.max(0, lastWhatsApp + WHATSAPP_COOLDOWN_MS - Date.now())));
        const result = await deliver(current, latestState.current);
        const sent = result.sent;
        if (sent?.whatsapp) lastWhatsApp = Date.now();
        if (sent && (sent.email || sent.whatsapp)) updateRef.current((state) => ({ ...state, alerts: state.alerts.map((alert) => alert.id === sent.alertId ? { ...alert, emailSentAt: alert.emailSentAt ?? sent.email, whatsappSentAt: alert.whatsappSentAt ?? sent.whatsapp } : alert) }));
        if (result.error) setSaveError(result.error);
        const rest = outboxRef.current.filter((other) => other !== current);
        if (result.left) { keepOutbox([result.left, ...rest]); break; }
        keepOutbox(rest);
        count += 1;
      }
    } finally {
      flushing.current = false;
      if (count) setLastSync({ count, at: Date.now() });
    }
  }, [keepOutbox, sync]);
  const queue = useCallback((item: OutboxItem) => { keepOutbox(enqueue(outboxRef.current, item)); void flush(); }, [keepOutbox, flush]);
  useEffect(() => {
    if (!hydrated) return;
    const send = () => void flush();
    send();
    window.addEventListener("online", send);
    // The browser can say online while nothing gets through (Wi-Fi with no internet), so what waits is retried too; on
    // the trial this also brings in other laptops' changes.
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
      // QR codes read a report's status live, so a revoke or supersede has to reach the server, now or once online. On
      // the trial every changed record goes up too.
      const changes = [...statusChanges(latestState.current, next), ...(IS_TRIAL ? changedItems(latestState.current, next).map(({ kind, id }): OutboxItem => ({ kind: "sync", item: kind, id })) : [])];
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
      if (!commit(next)) { setSaveError("KTrack could not save this change. Your previous state remains active."); return false; }
      setStorageWarning(undefined);
      setSaveError(undefined);
      return true;
    } catch { setSaveError("Browser storage is unavailable. Previous data is intact."); return false; }
  }, [commit]);
  const clearOperationalData = useCallback(() => restore(freshState(todayString())), [restore]);

  // Keep mine: it goes up again over their copy. Take theirs: this laptop's copy is replaced.
  const resolveConflict = useCallback((row: SyncRow, keep: "mine" | "theirs") => {
    const key = syncKey(row.kind, row.id);
    if (keep === "theirs" && !commit(recalculateAlerts(mergeRows(latestState.current, [row], new Set())))) { setSaveError("KTrack could not save this change. Your previous state remains active."); return; }
    const meta = loadSyncMeta(window.localStorage);
    saveSyncMeta(window.localStorage, { ...meta, versions: { ...meta.versions, [key]: row.version } });
    if (keep === "theirs") keepOutbox(outboxRef.current.filter((item) => !isSyncItem(item) || itemKey(item) !== key));
    keepConflicts(conflictsRef.current.filter((other) => syncKey(other.kind, other.id) !== key));
    void sync();
  }, [commit, keepOutbox, keepConflicts, sync]);

  // Signing out clears this laptop's copy, so it waits until every change has reached the server.
  const signOut = useCallback(async () => {
    const waiting = outboxRef.current.filter(isSyncItem).length;
    if (waiting) { setSaveError(`${waiting} change${waiting === 1 ? " hasn't" : "s haven't"} reached the server yet. Connect to the internet and wait for ${waiting === 1 ? "it" : "them"} to send before signing out.`); return; }
    const response = await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
    if (!response?.ok) { setSaveError("Signing out needs the internet. Try again once you're online."); return; }
    for (const key of [STORAGE_KEY, OUTBOX_KEY, SYNC_KEY]) window.localStorage.removeItem(key);
    window.location.replace("/sign-in");
  }, []);

  const value = useMemo(() => ({ state, hydrated, storageWarning, saveError, update, setRole, setDemoDate, clearOperationalData, restore, outbox, queue, lastSync, user, conflicts, resolveConflict, signOut }), [state, hydrated, storageWarning, saveError, update, setRole, setDemoDate, clearOperationalData, restore, outbox, queue, lastSync, user, conflicts, resolveConflict, signOut]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
