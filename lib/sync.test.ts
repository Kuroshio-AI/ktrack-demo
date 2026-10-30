import { strict as assert } from "node:assert";
import test from "node:test";
import { createInitialState } from "./domain";
import { enqueue, loadOutbox, OUTBOX_KEY, type OutboxItem } from "./outbox";
import { changedItems, customerKey, itemData, itemLabel, mergeRows, syncKey, type SyncRow } from "./sync";
import type { AppState, AssetRecord, DamageCriterion, Inspection } from "./types";

// Two jobs and a tally sheet on the first. Only the fields sync reads are filled in.
const job = (id: string, assetRef: string, owner = "Sample Drilling Co.") => ({ id, assetRef, owner, certificates: [], activity: [] }) as unknown as AssetRecord;
const sheet = (id: string, assetId: string, notes = "") => ({ id, assetId, notes }) as unknown as Inspection;
const workspace: AppState = { ...createInitialState("2026-10-30"), records: [job("job-1", "WO-1"), job("job-2", "WO-2")], inspections: [sheet("sheet-1", "job-1")] };
const row = (kind: SyncRow["kind"], id: string, data: unknown, version = 2, seq = 10): SyncRow => ({ kind, id, data, version, seq, updatedBy: "Sunny", updatedAt: "2026-10-30T09:00:00.000Z" });

test("a change lists the items it added, edited and removed, and nothing a copy left the same", () => {
  const after: AppState = {
    ...workspace,
    // job-1 copied but unchanged, job-2 removed, job-3 added; the sheet edited.
    records: [{ ...workspace.records[0] }, job("job-3", "WO-3")],
    inspections: [sheet("sheet-1", "job-1", "Box 7 re-measured")],
    criteria: [{ code: "TD", criterion: "Thread damage", outcome: "Rework" } as DamageCriterion],
  };
  assert.deepEqual(changedItems(workspace, after), [
    { kind: "record", id: "job-3" }, { kind: "record", id: "job-2" },
    { kind: "inspection", id: "sheet-1" },
    { kind: "criterion", id: "TD" },
  ]);
  assert.deepEqual(changedItems(workspace, { ...workspace }), []);
  assert.equal(itemData(after, "criterion", "TD"), after.criteria![0]);
  assert.equal(itemData(after, "record", "job-2"), null);
});

test("the server's copies replace this laptop's, except items with a change still waiting to go up", () => {
  const merged = mergeRows(workspace, [
    row("record", "job-1", job("job-1", "WO-1", "New Customer")),
    row("record", "job-2", null),
    row("inspection", "sheet-2", sheet("sheet-2", "job-1")),
    row("inspection", "sheet-1", sheet("sheet-1", "job-1", "theirs")),
  ], new Set([syncKey("inspection", "sheet-1")]));
  assert.deepEqual(merged.records.map((record) => [record.id, record.owner]), [["job-1", "New Customer"]], "job-2 was removed elsewhere");
  assert.deepEqual(merged.inspections.map((inspection) => [inspection.id, inspection.notes]), [["sheet-2", ""], ["sheet-1", ""]], "a new sheet goes on top; the waiting one keeps our notes");
  assert.deepEqual(mergeRows(workspace, [], new Set()), workspace);
});

test("sync items wait once per record and survive a reload", () => {
  const item: OutboxItem = { kind: "sync", item: "inspection", id: "sheet-1" };
  assert.deepEqual(enqueue(enqueue([], item), { ...item }), [item]);
  const stored = new Map([[OUTBOX_KEY, JSON.stringify([item, { kind: "sync", item: "alert", id: "a1" }])]]);
  assert.deepEqual(loadOutbox({ getItem: (key) => stored.get(key) ?? null }), [item], "alerts aren't a synced kind");
});

test("conflicts name the job, and customer names match whatever the spacing or case", () => {
  assert.equal(itemLabel(workspace, "inspection", "sheet-1"), "Tally sheet WO-1");
  assert.equal(itemLabel(workspace, "record", "job-9", job("job-9", "WO-9")), "Job WO-9");
  assert.equal(customerKey("  Sample   Drilling co. "), "sample drilling co.");
  assert.equal(customerKey(" "), null);
  assert.equal(customerKey(undefined), null);
});
