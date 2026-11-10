import { amsInitialState } from "./ams";
import { IS_AMS, IS_GEX, IS_TRIAL } from "./client";
import { STORAGE_KEY, createInitialState, recalculateAlerts, validateStoredState } from "./domain";
import { GEX_SEED, gexInitialState } from "./gex";
import type { AppState } from "./types";

// The AMS and GEX demo links are shared, so a new browser, or a reset, opens on the sample jobs or lots instead of an empty workspace. The
// trial starts empty and fills from the server.
// The trial says what to do next beside the message (components/app-shell.tsx), since it has no demo to restart.
const RECOVER = IS_TRIAL ? "" : " Start a fresh demo or recover manually.";

export const freshState = (demoDate?: string): AppState => IS_GEX ? gexInitialState(demoDate) : IS_AMS && !IS_TRIAL ? amsInitialState(demoDate) : createInitialState(demoDate);

export type LoadResult = { state: AppState; recovered: boolean; error?: string };

export function loadState(storage: Pick<Storage, "getItem"> | undefined, demoDate?: string): LoadResult {
  const initial = freshState(demoDate);
  if (!storage) return { state: initial, recovered: false };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { state: initial, recovered: false };
    const parsed: unknown = JSON.parse(raw);
    if (!validateStoredState(parsed)) return { state: initial, recovered: true, error: `Stored KTrack data is unsupported or corrupted.${RECOVER}` };
    // A GEX workspace from older sample lots is replaced, so everyone who opens the shared link sees the current demo.
    if (IS_GEX && parsed.gexSeed !== GEX_SEED) return { state: initial, recovered: false };
    return { state: recalculateAlerts(parsed), recovered: false };
  } catch {
    return { state: initial, recovered: true, error: `Stored KTrack data could not be read.${RECOVER}` };
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
