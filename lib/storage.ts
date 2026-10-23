import { amsInitialState } from "./ams";
import { IS_AMS } from "./client";
import { STORAGE_KEY, createInitialState, recalculateAlerts, validateStoredState } from "./domain";
import type { AppState } from "./types";

// The AMS demo link is shared, so a new browser, or a reset, opens on the sample jobs instead of an empty workspace.
export const freshState = (demoDate?: string): AppState => IS_AMS ? amsInitialState(demoDate) : createInitialState(demoDate);

export type LoadResult = { state: AppState; recovered: boolean; error?: string };

export function loadState(storage: Pick<Storage, "getItem"> | undefined, demoDate?: string): LoadResult {
  const initial = freshState(demoDate);
  if (!storage) return { state: initial, recovered: false };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { state: initial, recovered: false };
    const parsed: unknown = JSON.parse(raw);
    if (!validateStoredState(parsed)) return { state: initial, recovered: true, error: "Stored KTrack data is unsupported or corrupted. Start a fresh demo or recover manually." };
    return { state: recalculateAlerts(parsed), recovered: false };
  } catch {
    return { state: initial, recovered: true, error: "Stored KTrack data could not be read. Start a fresh demo or recover manually." };
  }
}

export function commitState(storage: Pick<Storage, "setItem"> | undefined, state: AppState): { ok: true } | { ok: false; error: string } {
  if (!storage) return { ok: false, error: "Browser storage is unavailable" };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return { ok: true };
  } catch {
    return { ok: false, error: "KTrack could not save this change. Your previous state remains active." };
  }
}
