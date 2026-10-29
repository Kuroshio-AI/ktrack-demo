"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createInitialState, recalculateAlerts, setDemoDate as setDate, setRole as setCurrentRole, todayString } from "@/lib/domain";
import { commitState, freshState, loadState } from "@/lib/storage";
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
};

const AppContext = createContext<AppContextValue | null>(null);

// QR codes read the status live, so a certificate that has had one tells the server when it is revoked or superseded.
async function publishStatusChanges(before: AppState, after: AppState): Promise<void> {
  const previous = new Map(before.records.flatMap((record) => record.certificates).map((certificate) => [certificate.id, certificate.status]));
  const changed = after.records.flatMap((record) => record.certificates).filter((certificate) => certificate.statusKey && certificate.status !== previous.get(certificate.id) && (certificate.status === "Revoked" || certificate.status === "Superseded"));
  const failed: string[] = [];
  await Promise.all(changed.map(async (certificate) => {
    const response = await fetch("/api/certificates/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ statusKey: certificate.statusKey, status: certificate.status }) }).catch(() => undefined);
    if (!response?.ok) failed.push(certificate.number);
  }));
  if (failed.length) throw new Error(`${failed.join(", ")} changed here, but QR codes already printed for ${failed.length === 1 ? "it" : "them"} still show the old status.`);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => createInitialState(todayString()));
  const latestState = useRef(state);
  const [hydrated, setHydrated] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string>();
  const [saveError, setSaveError] = useState<string>();

  useEffect(() => {
    try {
      const loaded = loadState(window.localStorage, todayString());
      latestState.current = loaded.state;
      setState(loaded.state);
      setStorageWarning(loaded.error);
    } catch { setStorageWarning("Browser storage is unavailable. Enable local storage to use the demo."); }
    finally { setHydrated(true); }
  }, []);

  const update = useCallback((updater: (current: AppState) => AppState): boolean => {
    if (!hydrated) { setSaveError("KTrack is still restoring this browser workspace."); return false; }
    if (storageWarning) { setSaveError("Storage recovery is required before normal changes can be saved."); return false; }
    try {
      const next = recalculateAlerts(updater(latestState.current));
      const result = commitState(window.localStorage, next);
      if (!result.ok) { setSaveError(result.error); return false; }
      setSaveError(undefined);
      publishStatusChanges(latestState.current, next).catch((error: Error) => setSaveError(error.message));
      latestState.current = next;
      setState(next);
      return true;
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Change could not be saved. Previous data is intact."); return false; }
  }, [hydrated, storageWarning]);

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

  const value = useMemo(() => ({ state, hydrated, storageWarning, saveError, update, setRole, setDemoDate, clearOperationalData, restore }), [state, hydrated, storageWarning, saveError, update, setRole, setDemoDate, clearOperationalData, restore]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
