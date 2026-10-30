import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sessionUser } from "@/lib/auth";
import { IS_TRIAL } from "@/lib/client";
import { customerKey, SYNC_KINDS, type SyncKind, type SyncRow } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One round trip per sync: a laptop sends the changes waiting in its outbox and the last change it has seen, and gets
// back which changes were taken, the server's copy of any that someone else changed first, and everything newer.
const MAX_CHANGES = 100;
// D1 keeps at most 2 MB in one value.
const MAX_ITEM_CHARS = 1_900_000;
const PAGE = 200;
const NEXT_SEQ = "(SELECT coalesce(max(seq), 0) + 1 FROM item)";
const COLUMNS = "kind, id, data, version, seq, updatedBy, updatedAt";

type Change = { kind: SyncKind; id: string; base: number; data: Record<string, unknown> | null };
const isChange = (value: unknown): value is Change => {
  if (!value || typeof value !== "object") return false;
  const change = value as Change;
  const ownId = change.data && (change.kind === "criterion" ? change.data.code : change.data.id);
  return (SYNC_KINDS as readonly unknown[]).includes(change.kind) && typeof change.id === "string" && change.id.length > 0 && change.id.length <= 200
    && Number.isSafeInteger(change.base) && change.base >= 0 && (change.data === null || (typeof change.data === "object" && !Array.isArray(change.data) && ownId === change.id));
};

const toRow = (row: Record<string, unknown>): SyncRow => ({ ...row, data: row.data === null ? null : JSON.parse(row.data as string) } as SyncRow);
// A report's status key can revoke its QR codes (app/api/certificates/status), so it never leaves for a customer account.
const forCustomer = (row: SyncRow): SyncRow => row.kind !== "record" || !row.data ? row
  : { ...row, data: { ...row.data, certificates: ((row.data as { certificates?: Record<string, unknown>[] }).certificates ?? []).map(({ statusKey: _, ...certificate }) => certificate) } };

export async function POST(request: Request) {
  if (!IS_TRIAL) return new Response(null, { status: 404 });
  const user = await sessionUser(request);
  if (!user) return NextResponse.json({ error: "Sign in again to sync." }, { status: 401 });
  const body = await request.json().catch(() => null) as { changes?: unknown; since?: unknown } | null;
  const changes = body?.changes;
  const since = body?.since;
  if (!Array.isArray(changes) || changes.length > MAX_CHANGES || !changes.every(isChange) || typeof since !== "number" || !Number.isSafeInteger(since) || since < 0) return NextResponse.json({ error: "Invalid sync request" }, { status: 400 });
  if (changes.length && user.role === "Customer") return NextResponse.json({ error: "Customer accounts can't change records." }, { status: 403 });
  const texts = changes.map((change) => change.data === null ? null : JSON.stringify(change.data));
  if (texts.some((text) => text && text.length > MAX_ITEM_CHARS)) return NextResponse.json({ error: "One item is over 2 MB, too large to sync. Remove some photos from it." }, { status: 413 });

  const db = getCloudflareContext().env.DB;
  const now = new Date().toISOString();
  // Jobs first, so a new tally sheet in the same request finds its job's customer. A removal that never reached the
  // server has nothing to remove.
  const writes = changes.map((change, index) => ({ change, text: texts[index] })).filter(({ change }) => change.data !== null || change.base > 0)
    .sort((a, b) => Number(b.change.kind === "record") - Number(a.change.kind === "record"));
  const statements = writes.flatMap(({ change, text }) => {
    // A job carries its customer; a tally sheet takes its job's; a removal keeps what the row had.
    const customer = change.data === null ? "customer" : change.kind === "record" ? "?" : change.kind === "inspection" ? "(SELECT customer FROM item WHERE kind = 'record' AND id = ?)" : "NULL";
    const customerArgs = change.data === null ? [] : change.kind === "record" ? [customerKey(change.data.owner)] : change.kind === "inspection" ? [change.data.assetId] : [];
    // Taken only from the version it was based on, so a change made elsewhere in between is never overwritten.
    const write = change.base === 0
      ? db.prepare(`INSERT INTO item (kind, id, data, version, seq, customer, updatedBy, updatedAt) VALUES (?, ?, ?, 1, ${NEXT_SEQ}, ${customer}, ?, ?) ON CONFLICT DO NOTHING`).bind(change.kind, change.id, text, ...customerArgs, user.name, now)
      : db.prepare(`UPDATE item SET data = ?, version = version + 1, seq = ${NEXT_SEQ}, customer = ${customer}, updatedBy = ?, updatedAt = ? WHERE kind = ? AND id = ? AND version = ?`).bind(text, ...customerArgs, user.name, now, change.kind, change.id, change.base);
    if (change.kind !== "record" || change.data === null) return [write];
    // A job's new customer carries over to its tally sheets, once the job's own change was taken. Each sheet gets a new
    // place in the order (rowids differ), so the customer's laptop fetches them. ponytail: scans every sheet's JSON per
    // job change; an assetId column if the trial grows past a few thousand sheets.
    const key = customerKey(change.data.owner);
    return [write, db.prepare(`UPDATE item SET customer = ?, seq = (SELECT max(seq) FROM item) + rowid WHERE kind = 'inspection' AND json_extract(data, '$.assetId') = ? AND customer IS NOT ? AND (SELECT customer FROM item WHERE kind = 'record' AND id = ?) IS ?`).bind(key, change.id, key, change.id, key)];
  });
  const results = statements.length ? await db.batch(statements) : [];
  // Each job's carry-over statement follows its write; only the writes say whether a change was taken.
  let position = 0;
  const applied: { kind: SyncKind; id: string; version: number }[] = [];
  const refused: Change[] = [];
  for (const { change } of writes) {
    const taken = results[position].meta.changes > 0;
    position += change.kind === "record" && change.data !== null ? 2 : 1;
    if (taken) applied.push({ kind: change.kind, id: change.id, version: change.base + 1 });
    else refused.push(change);
  }
  const conflicts = refused.length ? (await db.batch<Record<string, unknown>>(refused.map((change) => db.prepare(`SELECT ${COLUMNS} FROM item WHERE kind = ? AND id = ?`).bind(change.kind, change.id)))).flatMap((result) => result.results.map(toRow)) : [];

  const customer = customerKey(user.customer);
  if (user.role === "Customer" && !customer) return NextResponse.json({ applied, conflicts, rows: [], more: false });
  const pull = user.role === "Customer"
    ? db.prepare(`SELECT ${COLUMNS} FROM item WHERE seq > ? AND customer = ? AND kind IN ('record', 'inspection') ORDER BY seq LIMIT ?`).bind(since, customer, PAGE)
    : db.prepare(`SELECT ${COLUMNS} FROM item WHERE seq > ? ORDER BY seq LIMIT ?`).bind(since, PAGE);
  const rows = (await pull.all()).results.map(toRow).map((row) => user.role === "Customer" ? forCustomer(row) : row);
  return NextResponse.json({ applied, conflicts, rows, more: rows.length === PAGE }, { headers: { "Cache-Control": "no-store" } });
}
