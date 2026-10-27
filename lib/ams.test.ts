import assert from "node:assert/strict";
import test, { before } from "node:test";
import * as XLSX from "xlsx";
import type { ConnectionSpec, Inspection, Joint } from "./types";

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

test("a reading past Premium but inside Class 2 makes the pipe Class 2, past Class 2 scraps it, and a connection dimension means rework", () => {
  const tiered: ConnectionSpec = { id: "t", size: "5", weight: "19.50", connection: "NC50", grade: "G105", standard: "API RP 7G-2", limits: [
    { column: "Tool joint OD", min: 6.1, class2Min: 6 }, { column: "Tool joint ID", max: 3.8, class2Max: 3.95 }, { column: "Counterbore length", min: 0.55 },
  ] };
  const pipe = (values: Record<string, number>): Joint => ({ no: 1, values: { length: 31, remWall: 0.34, boxOd: 6.2, pinId: 3.75, cboreDepth: 0.6, ...values }, codes: {} });
  const grade = (values: Record<string, number>) => ams.gradePipe(tiered, job, pipe(values));
  assert.equal(grade({}).final, "Premium-Accepted");
  assert.equal(grade({ boxOd: 6.1 }).final, "Premium-Accepted", "on the Premium limit");
  assert.deepEqual([grade({ boxOd: 6.05 }).final, ams.failureText(grade({ boxOd: 6.05 }).failures[0])], ["Class-2", "Box OD 6.050, Premium min 6.100"]);
  assert.deepEqual([grade({ boxOd: 5.99 }).final, ams.failureText(grade({ boxOd: 5.99 }).failures[0])], ["Scrap", "Box OD 5.990, Class 2 min 6.000"]);
  assert.deepEqual([grade({ pinId: 3.9 }).final, grade({ pinId: 3.97 }).final], ["Class-2", "Scrap"], "a maximum works the same way");
  assert.equal(grade({ cboreDepth: 0.5 }).final, "Premium-Rework");
  assert.equal(ams.gradePipe(tiered, job, { no: 1, values: { length: 31, remWall: 0.34, boxOd: 6.2 }, codes: {} }).final, "Pending", "the RP 7G-2 columns make pin ID and c'bore depth required");
  assert.deepEqual([ams.class2Text(tiered.limits[0]), ams.class2Text({ column: "X", min: 1, max: 2, class2Min: 0.9 })], ["6.000", "min 0.900"], "the side word drops only under a one-sided Premium limit");
});

function workbook(rows: unknown[][], more: [string, unknown[][]][] = []): ArrayBuffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Table");
  for (const [name, sheet] of more) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheet), name);
  return XLSX.write(book, { bookType: "xlsx", type: "array" });
}

// Made-up values in the RP 7G-2 layout: the standard is licensed, so its numbers stay out of this public repo.
test("an API RP 7G-2 table in millimetres imports in inches, rounded to the safe side, with its connection limits added", () => {
  const { specs, errors, shared } = ams.parseConnectionsWorkbook(workbook([
    ["Size", "Weight", "Grade", "Connection", "Standard", "Unit", "Tool joint OD min", "Tool joint OD class 2 min", "Tool joint ID max", "Tool joint ID class 2 max"],
    ["5", "19.50", "G105", "NC50", "API RP 7G-2", "mm", 154.9, 152.5, 96.1, 100.05],
    ["", "", "S135", "", "", "", 160, 157, 87, 92],
    ["", "", "X95", "", "", "cm", 153, 151, 98, 101],
  ], [["Table C.7", [["Connection", "Unit", "Counterbore diameter max", "Counterbore length min"], ["NC50", "mm", 136.6, 14.3], ["NC46", "mm", 126.3, 14.3]]]]));
  assert.deepEqual(errors.map((error) => [error.row, error.field]), [[4, "Unit"]]);
  assert.equal(shared, 2);
  assert.deepEqual(specs.map((spec) => [spec.grade, spec.standard]), [["G105", "API RP 7G-2"], ["S135", "API RP 7G-2"]], "standard and unit carry down");
  assert.deepEqual(specs[0].limits, [
    { column: "Tool joint OD", min: 6.099, class2Min: 6.004 },
    { column: "Tool joint ID", max: 3.783, class2Max: 3.938 },
    { column: "Counterbore diameter", max: 5.377 },
    { column: "Counterbore length", min: 0.563 },
  ]);
  const boxOd = ams.TALLY_COLUMNS.find((column) => column.key === "boxOd")!;
  assert.deepEqual(ams.limitFor(boxOd, specs[0], job), { column: "Tool joint OD", min: 6.099, class2Min: 6.004 }, "RP 7G-2 names fill the F.582 columns");
  const state = { ...ams.createInitialState("2026-10-23"), connections: specs, equipment: [] };
  assert.equal(ams.createTally(state, { ...tallyInput, connectionId: specs[0].id }).inspection.job?.standard, "API RP 7G-2");
  assert.match(ams.parseConnectionsWorkbook(workbook([["Size", "Weight", "Connection", "Grade", "Box OD min", "Box OD class 2 min"], ["5", "19.50", "XT50", "S", 6.19, 6.25]])).errors[0].message, /tighter/);
});

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

test("recording a calibration sets both dates, clears the instrument's alert and is logged", () => {
  const state = ams.amsInitialState("2026-10-23");
  const gauge = state.equipment!.find((item) => item.kind === "Lead gauge")!;
  const open = (current: typeof state) => current.alerts.filter((alert) => alert.event === "Calibration due" && alert.status === "open" && alert.assetRef === `Lead gauge ${gauge.serial}`);
  assert.equal(open(ams.recalculateAlerts(state)).length, 1);
  const next = ams.recalculateAlerts(ams.recordCalibration(state, gauge.id, "2026-10-23", "2027-10-23", "Manager"));
  const after = next.equipment!.find((item) => item.id === gauge.id)!;
  assert.deepEqual([after.calibratedOn, after.calibrationDue, ams.calibrationStatus(after, next.demoDate), open(next).length], ["2026-10-23", "2027-10-23", "Valid", 0]);
  assert.deepEqual([next.activity[0].event, next.activity[0].actor], ["Instrument calibrated", "Manager"]);
  assert.ok(ams.validateStoredState(next), "the stored state keeps validating");
  assert.throws(() => ams.recordCalibration(state, gauge.id, "2026-10-24", "2027-10-24"), /future/);
  assert.throws(() => ams.recordCalibration(state, gauge.id, "2026-10-23", "2026-10-23"), /after the calibration date/);
  assert.throws(() => ams.recordCalibration(state, "gone", "2026-10-23", "2027-10-23"), /no longer listed/);
});

test("damage criteria decide what a code does: changing one regrades open sheets but not issued reports", () => {
  const state = ams.amsInitialState("2026-10-23");
  const draft = (current: typeof state) => current.inspections.find((item) => item.status === "Draft")!;
  const issued = (current: typeof state) => current.inspections.find((item) => item.status === "Issued")!;
  const classOf = (inspection: Inspection, code: string) => inspection.joints!.filter((joint) => Object.values(joint.codes).includes(code)).map((joint) => ams.gradePipe(inspection.connection!, inspection.job!, joint).final);
  assert.deepEqual(classOf(draft(state), "TD"), ["Premium-Rework"]);
  const before = classOf(issued(state), "TD");
  const next = ams.updateCriterion(state, "TD", { outcome: "Class 2" });
  assert.deepEqual(classOf(draft(next), "TD"), ["Class-2"]);
  assert.deepEqual(classOf(issued(next), "TD"), before, "an issued report keeps the criteria it was graded with");
  assert.equal(next.activity[0].event, "Damage criterion changed");
  const repaired = ams.gradePipe(spec, { nominalWall: 0.362, criteria: next.criteria }, with_((joint) => { joint.codes.boxCond = "NFS"; }));
  assert.deepEqual([repaired.final, repaired.repaired], ["Premium-Accepted", "box"], "a field repair keeps the class");
  const reworded = ams.updateCriterion(next, "TD", { criterion: "Our own wording." });
  assert.deepEqual(reworded.criteria?.find((item) => item.code === "TD"), { code: "TD", criterion: "Our own wording.", outcome: "Class 2" }, "rewording drops the Sample mark");
  assert.equal(ams.updateCriterion(reworded, "TD", { outcome: "Class 2" }), reworded, "no change, no new state");
  assert.throws(() => ams.updateCriterion(state, "TD", { criterion: "  " }), /Describe/);
  assert.ok(ams.validateStoredState(JSON.parse(JSON.stringify(reworded))));
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
