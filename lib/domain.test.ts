import assert from "node:assert/strict";
import test from "node:test";
import { acknowledgeAlert, addMonthsClamped, approveInspection, changeCertificateStatus, createInitialState, createInspection, dateDiffDays, deadlineLabel, deadlineWhen, deleteInspection, importRows, nextDeadline, recalculateAlerts, returnInspection, rowToRecord, submitInspection, updateInspection } from "./domain";
import { commitState, loadState } from "./storage";
import type { AppState } from "./types";

function stateWithRecord(due = "2026-02-15"): AppState {
  const state = createInitialState("2026-02-15");
  const record = rowToRecord({ assetRef: "HAR-001", recordType: "equipment", assetType: "Harness", site: "Northpoint", owner: "Maya", inspectionDueDate: due, inspectionIntervalMonths: 1, licenceExpiryDate: "2027-01-10", retirementDueDate: "2028-01-10", status: "Active" }, "Admin", "2026-02-15T00:00:00.000Z");
  return { ...state, records: [record] };
}

test("alerts reconcile the 30/7/today/overdue tiers without reload duplicates", () => {
  let state = stateWithRecord("2026-03-17");
  state = recalculateAlerts(state, "2026-02-15T00:00:00.000Z");
  assert.equal(state.alerts.filter((alert) => alert.status === "open" && alert.tier === "due30").length, 1);
  state = recalculateAlerts({ ...state, demoDate: "2026-03-10" });
  assert.equal(state.alerts.filter((alert) => alert.status === "open" && alert.tier === "due7").length, 1);
  state = recalculateAlerts({ ...state, demoDate: "2026-03-17" });
  const today = state.alerts.find((alert) => alert.status === "open" && alert.tier === "today");
  assert.ok(today);
  state = acknowledgeAlert(state, today.id, "Admin", "2026-03-17T00:00:00.000Z");
  state = recalculateAlerts({ ...state, demoDate: "2026-03-18" });
  assert.equal(state.alerts.filter((alert) => alert.status === "open" && alert.tier === "overdue").length, 1);
  assert.equal(state.alerts.filter((alert) => alert.status === "open" && alert.occurrenceKey === today.occurrenceKey).some((alert) => alert.acknowledgedAt), false);
  const count = state.alerts.length;
  assert.equal(recalculateAlerts(state).alerts.length, count);
});

test("return, resubmit and approve are guarded and approval is idempotent", () => {
  let state = stateWithRecord("2026-02-15");
  const created = createInspection(state, state.records[0].id, "Engineer", "2026-02-15T00:00:00.000Z");
  state = created.state;
  const passed = created.inspection.checklist.map((item) => ({ ...item, result: "pass" as const }));
  state = updateInspection(state, created.inspection.id, { checklist: passed });
  state = submitInspection(state, created.inspection.id);
  assert.deepEqual(submitInspection(state, created.inspection.id).inspections.find((item) => item.id === created.inspection.id)?.status, "Submitted");
  const returned = returnInspection(state, created.inspection.id, "Add a clearer photo", "Reviewer", "2026-02-16T00:00:00.000Z");
  assert.equal(returned.inspections[0].status, "Returned");
  const resubmitted = submitInspection(returned, created.inspection.id);
  const issued = approveInspection(resubmitted, created.inspection.id, "2027-02-15", "Reviewer", "2026-02-17T00:00:00.000Z");
  assert.equal(issued.inspections[0].status, "Issued");
  assert.equal(issued.records[0].certificates.length, 1);
  assert.equal(approveInspection(issued, created.inspection.id, "2027-02-15").records[0].certificates.length, 1);
  assert.equal(issued.records[0].licenceExpiryDate, "2027-01-10");
  assert.equal(issued.records[0].retirementDueDate, "2028-01-10");
  assert.equal(issued.records[0].inspectionDueDate, addMonthsClamped("2026-02-15", 1));
});

test("local state round trips after an import", () => {
  const initial = createInitialState("2026-02-15");
  const next = importRows(initial, [{ assetRef: "A-1", recordType: "equipment", assetType: "Anchor", site: "Site", owner: "Owner", status: "Active" }], "Admin", "2026-02-15T00:00:00.000Z");
  let stored = "";
  assert.equal(commitState({ setItem: (_key, value) => { stored = value; } }, next).ok, true);
  const loaded = loadState({ getItem: () => stored }, "2026-02-15");
  assert.equal(loaded.recovered, false);
  assert.equal(loaded.state.records[0].assetRef, "A-1");
});

test("month-end recurrence clamps the day", () => {
  assert.equal(addMonthsClamped("2026-01-31", 1), "2026-02-28");
  assert.equal(dateDiffDays("2026-02-28", "2026-01-31"), 28);
});

test("commit-time import limits and duplicates preserve the previous register", () => {
  const state = stateWithRecord();
  assert.throws(() => importRows(state, [{ ...state.records[0], assetRef: " har-001 " }]), /preview/i);
  const rows = Array.from({ length: 500 }, (_, index) => ({ ...state.records[0], assetRef: `NEW-${index}` }));
  assert.throws(() => importRows(state, rows), /500 total/);
  assert.equal(state.records.length, 1);
});

test("issued evidence is immutable, and expired/revoked certificates retain alert history", () => {
  const initial = stateWithRecord();
  const created = createInspection(initial, initial.records[0].id);
  let state = updateInspection(created.state, created.inspection.id, { checklist: created.inspection.checklist.map((item) => ({ ...item, result: "pass" })) });
  state = submitInspection(state, created.inspection.id);
  assert.equal(updateInspection(state, created.inspection.id, { notes: "Changed during review" }).inspections[0].notes, "");
  state = approveInspection(state, created.inspection.id, state.demoDate);
  assert.equal(state.alerts.filter((alert) => alert.event === "Certificate issued").length, 1);
  const certificate = state.records[0].certificates[0];
  state = recalculateAlerts({ ...state, demoDate: "2026-02-16" });
  assert.ok(state.alerts.some((alert) => alert.event === "Certificate expiry" && alert.tier === "overdue" && alert.status === "open"));
  assert.equal(state.alerts.filter((alert) => alert.event === "Certificate expired").length, 1);
  state = changeCertificateStatus(state, state.records[0].id, certificate.id, "Revoked");
  assert.ok(!state.alerts.some((alert) => alert.event === "Certificate expiry" && alert.status === "open"));
  assert.equal(state.alerts.filter((alert) => alert.event === "Certificate revoked").length, 1);
  assert.equal(changeCertificateStatus(state, state.records[0].id, certificate.id, "Revoked"), state);
});

test("drafts can be deleted, submitted work cannot, and the assigned engineer inspects", () => {
  const base = stateWithRecord();
  const state = { ...base, records: [{ ...base.records[0], assignedEngineer: "Leo Hart" }] };
  const draft = createInspection(state, state.records[0].id, "Admin");
  assert.equal(draft.inspection.inspector, "Leo Hart");
  assert.equal(deleteInspection(draft.state, draft.inspection.id).inspections.length, 0);
  const passed = draft.inspection.checklist.map((item) => ({ ...item, result: "pass" as const }));
  const submitted = submitInspection(updateInspection(draft.state, draft.inspection.id, { checklist: passed }), draft.inspection.id);
  assert.equal(deleteInspection(submitted, draft.inspection.id).inspections.length, 1);
});

test("nextDeadline returns the most urgent obligation", () => {
  const state = stateWithRecord("2026-02-12");
  const deadline = nextDeadline(state.records[0], state.demoDate);
  assert.equal(deadline?.key, "inspection");
  assert.equal(deadline?.days, -3);
});

test("deadline labels say which obligation is due and when", () => {
  assert.equal(deadlineLabel({ event: "Retirement due", days: 30 }), "Retirement due in 30 days");
  assert.equal(deadlineLabel({ event: "Inspection due", days: 0 }), "Inspection due today");
  assert.equal(deadlineLabel({ event: "Inspection due", days: -3 }), "Inspection 3 days overdue");
  assert.equal(deadlineLabel({ event: "Licence expiry", days: 1 }), "Licence expires in 1 day");
  assert.equal(deadlineLabel({ event: "Certificate expiry", days: -2 }), "Certificate expired 2 days ago");
  assert.deepEqual([0, 30, 1, -3].map((days) => deadlineWhen(days)), ["Today", "In 30 days", "In 1 day", "3 days overdue"]);
});
