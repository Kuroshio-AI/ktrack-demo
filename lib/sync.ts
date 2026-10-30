import type { AppState } from "./types";

// The trial shares records through the server (app/api/sync), one row per item: a job, a tally sheet, a dimension table
// row, an instrument, a damage criterion or an audit entry. A change waits in the outbox as the item's kind and id, and
// goes up as the item's latest copy with the version it was based on. The server takes it only if nobody changed the item
// since; otherwise both copies are shown and the person picks one. Alerts and the demo date stay on each laptop.
export const SYNC_KEY = "ktrack-sync";
export const SYNC_KINDS = ["record", "inspection", "connection", "equipment", "criterion", "activity"] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];

type Item = { id?: string; code?: string };
const COLLECTIONS: Record<SyncKind, { list: (state: AppState) => readonly Item[] | undefined; with: (state: AppState, items: never[]) => AppState }> = {
  record: { list: (state) => state.records, with: (state, records) => ({ ...state, records }) },
  inspection: { list: (state) => state.inspections, with: (state, inspections) => ({ ...state, inspections }) },
  connection: { list: (state) => state.connections, with: (state, connections) => ({ ...state, connections }) },
  equipment: { list: (state) => state.equipment, with: (state, equipment) => ({ ...state, equipment }) },
  criterion: { list: (state) => state.criteria, with: (state, criteria) => ({ ...state, criteria }) },
  activity: { list: (state) => state.activity, with: (state, activity) => ({ ...state, activity }) },
};
const idOf = (kind: SyncKind, item: Item) => (kind === "criterion" ? item.code : item.id) ?? "";
export const syncKey = (kind: SyncKind, id: string) => `${kind}:${id}`;

// The items a change added, edited or removed.
export function changedItems(before: AppState, after: AppState): { kind: SyncKind; id: string }[] {
  return SYNC_KINDS.flatMap((kind) => {
    const old = new Map((COLLECTIONS[kind].list(before) ?? []).map((item) => [idOf(kind, item), item]));
    const changed: { kind: SyncKind; id: string }[] = [];
    for (const item of COLLECTIONS[kind].list(after) ?? []) {
      const id = idOf(kind, item);
      const previous = old.get(id);
      if (previous !== item && JSON.stringify(previous) !== JSON.stringify(item)) changed.push({ kind, id });
      old.delete(id);
    }
    return [...changed, ...[...old.keys()].map((id) => ({ kind, id }))];
  });
}

export const itemData = (state: AppState, kind: SyncKind, id: string): unknown =>
  COLLECTIONS[kind].list(state)?.find((item) => idOf(kind, item) === id) ?? null;

export type SyncRow = { kind: SyncKind; id: string; data: unknown; version: number; seq: number; updatedBy: string; updatedAt: string };

// Puts the server's copies into the workspace, except items with a change of ours still waiting: those go up first.
// A null copy means the item was removed. New sheets and audit entries go on top, as the app lists them newest first.
export function mergeRows(state: AppState, rows: SyncRow[], waiting: Set<string>): AppState {
  let next = state;
  for (const kind of SYNC_KINDS) {
    const incoming = rows.filter((row) => row.kind === kind && !waiting.has(syncKey(kind, row.id)));
    if (!incoming.length) continue;
    const latest = new Map(incoming.map((row) => [row.id, row.data as Item | null]));
    const current = COLLECTIONS[kind].list(next) ?? [];
    const kept = current.flatMap((item) => {
      const id = idOf(kind, item);
      if (!latest.has(id)) return [item];
      const copy = latest.get(id);
      latest.delete(id);
      return copy ? [copy] : [];
    });
    const added = [...latest.values()].filter((item): item is Item => Boolean(item));
    next = COLLECTIONS[kind].with(next, (kind === "inspection" || kind === "activity" ? [...added.reverse(), ...kept] : [...kept, ...added]) as never[]);
  }
  return next;
}

// What this laptop knows about the server: the last change it has seen, and the version each item was at.
// The signed-in account is kept too, so the app opens offline as the last person who signed in.
export type TrialUser = { id: string; name: string; email: string; role: "Admin" | "Engineer" | "Reviewer" | "Manager" | "Customer"; customer?: string | null };
export type SyncMeta = { cursor: number; versions: Record<string, number>; user?: TrialUser };
export function loadSyncMeta(storage: Pick<Storage, "getItem">): SyncMeta {
  try {
    const parsed = JSON.parse(storage.getItem(SYNC_KEY) ?? "null") as Partial<SyncMeta> | null;
    if (parsed && typeof parsed.cursor === "number" && parsed.versions && typeof parsed.versions === "object") return parsed as SyncMeta;
  } catch { /* starts over: the next sync fetches everything */ }
  return { cursor: 0, versions: {} };
}
export const saveSyncMeta = (storage: Pick<Storage, "setItem">, meta: SyncMeta) => storage.setItem(SYNC_KEY, JSON.stringify(meta));

// A conflict names the item the way the app does: the job number for a job or its tally sheet.
export function itemLabel(state: AppState, kind: SyncKind, id: string, data?: unknown): string {
  const item = (data ?? itemData(state, kind, id)) as Record<string, unknown> | null;
  const job = (assetId: unknown) => state.records.find((record) => record.id === assetId)?.assetRef;
  if (kind === "record") return `Job ${(item?.assetRef as string | undefined) ?? id}`;
  if (kind === "inspection") return `Tally sheet ${job(item?.assetId) ?? id}`;
  if (kind === "connection") return "A dimension table row";
  if (kind === "equipment") return `Instrument ${(item?.serial as string | undefined) ?? id}`;
  if (kind === "criterion") return `Damage criterion ${id}`;
  return "An audit entry";
}

// Customer accounts see jobs whose Customer field matches theirs, ignoring case and spacing.
export const customerKey = (name: unknown) => typeof name === "string" && name.trim() ? name.trim().replace(/\s+/g, " ").toLowerCase() : null;
