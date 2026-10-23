import assert from "node:assert/strict";
import test, { before } from "node:test";
import * as XLSX from "xlsx";
import type { ConnectionSpec, Joint } from "./types";

// The AMS build is chosen at build time; node --test runs each file in its own process, so setting it here touches no other test.
process.env.NEXT_PUBLIC_CLIENT = "ams";
let ams: typeof import("./domain") & typeof import("./ams") & typeof import("./tally") & typeof import("./storage");
before(async () => { ams = { ...await import("./domain"), ...await import("./ams"), ...await import("./tally"), ...await import("./storage") }; });

const spec: ConnectionSpec = { id: "c1", size: "5", weight: "19.50", connection: "Demo 50", grade: "S", limits: [{ column: "Box OD", min: 6.19 }, { column: "Bevel diameter", min: 6.41, max: 6.56 }] };
const job = { nominalWall: 0.362 };
// A pipe that passes: length and remaining wall in, and every reading that has a limit inside it.
const good = (): Joint => ({ no: 1, values: { length: 31.2, remWall: 0.34, boxOd: 6.25, boxBevel: 6.5, pinBevel: 6.5 }, codes: {} });
const with_ = (change: (joint: Joint) => void) => { const joint = good(); change(joint); return joint; };

test("a pipe is Premium-Accepted only when every required reading is in and inside its limits", () => {
  assert.equal(ams.gradePipe(spec, job, good()).final, "Premium-Accepted");
  assert.equal(ams.gradePipe(spec, job, with_((joint) => { joint.values.boxOd = 6.1904; joint.values.boxBevel = 6.5604; })).final, "Premium-Accepted", "on the limit, at three decimals");
  assert.equal(ams.gradePipe(spec, job, with_((joint) => { delete joint.values.boxOd; })).final, "Pending");
  assert.equal(ams.gradePipe(spec, job, with_((joint) => { delete joint.values.length; })).final, "Pending", "length is always required");
  assert.equal(ams.gradePipe(spec, job, with_((joint) => { joint.values.remWall = 0.2896; })).final, "Premium-Accepted", "80% of 0.362 is 0.2896");
});

test("KTrack suggests the class from the failed limits and condition codes, and the inspector can change it", () => {
  const suggest = (change: (joint: Joint) => void) => ams.gradePipe(spec, job, with_(change));
  assert.equal(suggest((joint) => { joint.values.boxOd = 6.155; }).suggested, "Class-2");
  assert.equal(suggest((joint) => { joint.values.remWall = 0.28; }).suggested, "Class-2", "under 80% of nominal");
  assert.equal(suggest((joint) => { joint.values.remWall = 0.25; }).suggested, "Scrap", "under 70% of nominal");
  assert.equal(suggest((joint) => { joint.codes.boxMpi = "CRK"; }).suggested, "Scrap");
  assert.equal(suggest((joint) => { joint.codes.odCond = "BENT"; }).suggested, "Bent");
  const thread = suggest((joint) => { joint.codes.boxCond = "TD"; });
  assert.deepEqual([thread.suggested, thread.rework], ["Premium-Rework", "box"]);
  assert.equal(suggest((joint) => { joint.values.pinBevel = 6.6; joint.codes.boxCond = "SD"; }).rework, "both");
  const refaced = suggest((joint) => { joint.codes.boxCond = "RFD"; });
  assert.deepEqual([refaced.final, refaced.repaired], ["Premium-Accepted", "box"], "re-faced is a field repair, not a defect");
  assert.equal(ams.failureText(suggest((joint) => { joint.values.boxOd = 6.155; }).failures[0]), "Box OD 6.155, min 6.190");
  assert.equal(ams.gradePipe(spec, job, { ...with_((joint) => { joint.codes.boxCond = "TD"; }), finalClass: "Scrap" }).final, "Scrap", "the inspector's call wins");
  assert.equal(ams.gradePipe(spec, job, { ...with_((joint) => { delete joint.values.boxOd; }), finalClass: "Scrap" }).final, "Scrap", "and closes a pipe left unmeasured");
});

test("the summary fills the F.581 results table: classes, rework by side and coating 3 and 4", () => {
  const pipes = [good(), with_((joint) => { joint.codes.boxCond = "TD"; }), with_((joint) => { joint.values.pinBevel = 6.6; }), with_((joint) => { joint.values.boxOd = 6.1; joint.coating = 3; }), with_((joint) => { delete joint.values.boxOd; })];
  const summary = ams.summarizeTally(spec, job, pipes);
  const row = (label: string) => summary.rows.find((item) => item.label === label)!;
  assert.deepEqual([summary.total, summary.pending, summary.accepted, summary.downgraded.length], [5, 1, 1, 3]);
  assert.equal(row("Total pipe inspected").count, 4);
  assert.deepEqual([row("Premium-Rework").count, row("Premium-Rework").rework.box, row("Premium-Rework").rework.pin], [2, 1, 1]);
  assert.equal(row("Class-2").count, 1);
  assert.equal(row("ID coating cond. 3 & 4").count, 1);
});

function workbook(rows: unknown[][]): ArrayBuffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Table");
  return XLSX.write(book, { bookType: "xlsx", type: "array" });
}

test("the dimension table template reads back as the same connections", () => {
  const { specs, errors } = ams.parseConnectionsWorkbook(workbook(ams.templateMatrix()));
  assert.deepEqual(errors, []);
  assert.deepEqual(specs.map(({ id: _, ...rest }) => rest), ams.SAMPLE_CONNECTIONS.map(({ id: _, sample: __, ...rest }) => rest));
});

test("a blank size, weight or connection repeats the row above, and bad cells are reported per row", () => {
  const { specs, errors } = ams.parseConnectionsWorkbook(workbook([
    ["Dimension table"],
    ["Size", "Weight", "Connection", "Grade", "Box OD min", "Bevel diameter max", "Bevel diameter min"],
    ["5", "19.50", "Demo 50", "G", 6.06, 6.56, 6.41],
    ["", "", "", "S", 6.19, 6.56, 6.41],
    ["", "", "", "", 6.25, 6.56, 6.41],
    ["", "", "", "V-150", "six", 6.56, 6.41],
    ["", "", "", "X", 6.3, 6.41, 6.56],
  ]));
  assert.deepEqual(specs.map((item) => `${item.size} ${item.weight} ${item.connection} ${item.grade}`), ["5 19.50 Demo 50 G", "5 19.50 Demo 50 S"]);
  assert.deepEqual(specs[1].limits, [{ column: "Box OD", min: 6.19 }, { column: "Bevel diameter", min: 6.41, max: 6.56 }]);
  assert.deepEqual(errors.map((error) => [error.row, error.field]), [[5, "Grade"], [6, "Box OD min"], [7, "Bevel diameter"]]);
  assert.throws(() => ams.parseConnectionsWorkbook(workbook([["Connection", "Grade"]])), /template/);
});

test("importing replaces a connection with the same size, weight, connection and grade, and adds the rest", () => {
  const state = { ...ams.createInitialState("2026-10-23"), connections: [spec] };
  const next = ams.importConnections(state, [{ ...spec, id: "new", limits: [] }, { ...spec, id: "g", grade: "G" }]);
  assert.deepEqual(next.connections?.map((item) => item.id), ["new", "g"]);
});

const tallyInput = { jobNo: "WO-1", customer: "Demo Co.", rig: "Rig 1", well: "W-1", location: "Yard", connectionId: "c1", joints: 2, inspector: "Demo Inspector", range: "R2", nominalWall: 0.362, serviceCategory: "Category 4" };

test("a job opens one empty line per pipe, submits once every pipe is graded, and issues a report with its rejects listed", () => {
  const base = { ...ams.createInitialState("2026-10-23"), connections: [spec], equipment: [{ id: "g1", kind: "UT gauge", model: "UTG", serial: "1", calibrationDue: "2026-12-01" }] };
  const { state, inspection } = ams.createTally(base, tallyInput);
  assert.deepEqual([inspection.joints?.length, inspection.job?.equipmentIds], [2, ["g1"]]);
  assert.equal(state.records[0].assetType, '5" 19.50 Demo 50 grade S');
  assert.throws(() => ams.createTally(state, tallyInput), /already exists/);
  assert.equal(ams.submitInspection(state, inspection.id).inspections[0].status, "Draft", "nothing measured yet");
  const measured = ams.updateInspection(state, inspection.id, { joints: [{ ...good(), no: 1 }, { ...with_((joint) => { joint.codes.boxMpi = "CRK"; }), no: 2 }] });
  const submitted = ams.submitInspection(measured, inspection.id);
  assert.equal(submitted.inspections[0].status, "Submitted");
  assert.equal(submitted.inspections[0].job?.equipment?.[0].calibrationDue, "2026-12-01", "the report keeps the calibration it was checked against");
  const issued = ams.approveInspection(submitted, inspection.id, "2027-04-23", "Reviewer");
  assert.equal(issued.inspections[0].status, "Issued");
  assert.equal(issued.activity[0].event, "Report issued");
});

test("a tally sheet can't be submitted while one of its instruments is out of calibration, and calibration raises an alert", () => {
  const base = { ...ams.createInitialState("2026-10-23"), connections: [spec], equipment: [{ id: "g1", kind: "Lead gauge", model: "LG", serial: "7", calibrationDue: "2026-10-20" }] };
  const { state, inspection } = ams.createTally(base, { ...tallyInput, joints: 1 });
  const measured = ams.updateInspection(state, inspection.id, { joints: [good()] });
  assert.equal(ams.submitInspection(measured, inspection.id).inspections[0].status, "Draft");
  assert.deepEqual(ams.expiredEquipment(measured.equipment!, ["g1"], measured.demoDate).map((item) => item.kind), ["Lead gauge"]);
  const alert = ams.recalculateAlerts(measured).alerts.find((item) => item.event === "Calibration due");
  assert.deepEqual([alert?.assetRef, alert?.tier], ["Lead gauge 7", "overdue"]);
});

test("an added instrument joins the register and new tally sheets, and its serial must be new", () => {
  const base = { ...ams.createInitialState("2026-10-23"), connections: [spec], equipment: [] };
  const { state, item } = ams.addEquipment(base, { kind: " Thread gauge ", model: "TG-2", serial: "TG-0042", calibrationDue: "2026-11-10" });
  assert.deepEqual([item.kind, state.equipment?.length], ["Thread gauge", 1]);
  assert.deepEqual(ams.createTally(state, tallyInput).inspection.job?.equipmentIds, [item.id]);
  assert.ok(ams.recalculateAlerts(state).alerts.some((alert) => alert.event === "Calibration due" && alert.assetRef === "Thread gauge TG-0042"), "due within 30 days");
  assert.throws(() => ams.addEquipment(state, { kind: "Thread gauge", model: "TG-2", serial: "tg-0042", calibrationDue: "2027-01-01" }), /already listed/);
  assert.throws(() => ams.addEquipment(state, { kind: "Thread gauge", model: "", serial: "TG-7", calibrationDue: "2027-01-01" }), /model/);
  assert.throws(() => ams.addEquipment(state, { kind: "Thread gauge", model: "TG-2", serial: "TG-7", calibrationDue: "" }), /due date/);
});

test("a new browser opens on the sample jobs, and that workspace survives a save and reload", () => {
  const state = ams.amsInitialState("2026-10-23");
  assert.ok(ams.validateStoredState(JSON.parse(JSON.stringify(state))));
  assert.deepEqual(state.inspections.map((item) => item.status).sort(), ["Draft", "Issued"]);
  const draft = state.inspections.find((item) => item.status === "Draft")!;
  const summary = ams.summarizeTally(draft.connection!, draft.job!, draft.joints!);
  const count = (label: string) => summary.rows.find((row) => row.label === label)!.count;
  assert.deepEqual([summary.accepted, summary.pending, count("Premium-Rework"), count("Class-2"), count("Bent"), count("Scrap"), count("ID coating cond. 3 & 4")], [30, 3, 3, 2, 1, 1, 1]);
  assert.ok(state.alerts.some((alert) => alert.event === "Calibration due" && alert.assetRef?.startsWith("Lead gauge")));
  assert.equal(ams.loadState(undefined, "2026-10-23").state.inspections.length, 2);
});
