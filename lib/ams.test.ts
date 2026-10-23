import assert from "node:assert/strict";
import test, { before } from "node:test";
import * as XLSX from "xlsx";
import type { ConnectionSpec, Joint } from "./types";

// The AMS build is chosen at build time; node --test runs each file in its own process, so setting it here touches no other test.
process.env.NEXT_PUBLIC_CLIENT = "ams";
let ams: typeof import("./domain") & typeof import("./ams") & typeof import("./tally") & typeof import("./storage");
before(async () => { ams = { ...await import("./domain"), ...await import("./ams"), ...await import("./tally"), ...await import("./storage") }; });

const spec: ConnectionSpec = { id: "c1", size: "5", weight: "19.50", connection: "Demo 50", grade: "S", limits: [{ column: "Box OD", min: 6.19 }, { column: "Bevel diameter", min: 6.41, max: 6.56 }] };
const joint = (values: Joint["values"], visual: Joint["visual"] = "pass"): Joint => ({ no: 1, values, visual });

test("a joint is Premium only when every value is within its limits and the visual check passed", () => {
  assert.equal(ams.gradeJoint(spec, joint({ "Box OD": 6.19, "Bevel diameter": 6.56 })).grade, "Premium");
  assert.equal(ams.gradeJoint(spec, joint({ "Box OD": 6.1904, "Bevel diameter": 6.5604 })).grade, "Premium", "compared at three decimals");
  assert.equal(ams.gradeJoint(spec, joint({ "Box OD": 6.25 })).grade, "Pending", "a value still missing");
  assert.equal(ams.gradeJoint(spec, joint({ "Box OD": 6.25, "Bevel diameter": 6.5 }, "pending")).grade, "Pending", "visual not done");
});

test("one value past its limit, or a failed visual check, rejects the joint at once", () => {
  const low = ams.gradeJoint(spec, joint({ "Box OD": 6.155 }, "pending"));
  assert.equal(low.grade, "Reject");
  assert.deepEqual(low.failures, [{ column: "Box OD", value: 6.155, limit: 6.19, side: "min" }]);
  assert.equal(ams.failureText(low.failures[0]), "Box OD 6.155, min 6.190");
  assert.equal(ams.gradeJoint(spec, joint({ "Box OD": 6.1, "Bevel diameter": 6.6 })).failures.length, 2);
  assert.equal(ams.gradeJoint(spec, joint({ "Box OD": 6.25, "Bevel diameter": 6.5 }, "fail")).grade, "Reject");
});

test("the summary counts grades and the reasons for each reject", () => {
  const joints = [joint({ "Box OD": 6.25, "Bevel diameter": 6.5 }), joint({ "Box OD": 6.1, "Bevel diameter": 6.6 }), joint({ "Box OD": 6.1, "Bevel diameter": 6.5 }), joint({ "Box OD": 6.25, "Bevel diameter": 6.5 }, "fail"), joint({})];
  const summary = ams.summarizeTally(spec, joints);
  assert.deepEqual({ total: summary.total, premium: summary.premium, reject: summary.reject, pending: summary.pending }, { total: 5, premium: 1, reject: 3, pending: 1 });
  assert.deepEqual(summary.reasons, [{ column: "Box OD", count: 2 }, { column: "Bevel diameter", count: 1 }, { column: "Visual", count: 1 }]);
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

test("a job opens with one empty line per joint and its own copy of the limits, and submits only when every joint is graded", () => {
  const base = { ...ams.createInitialState("2026-10-23"), connections: [spec] };
  const input = { jobNo: "JOB-1", customer: "Demo Co.", rig: "Rig 1", connectionId: "c1", joints: 2, inspector: "Demo Inspector" };
  const { state, inspection } = ams.createTally(base, input);
  assert.equal(inspection.joints?.length, 2);
  assert.equal(state.records[0].assetType, '5" 19.50 Demo 50 grade S');
  assert.throws(() => ams.createTally(state, input), /already exists/);
  assert.equal(ams.submitInspection(state, inspection.id).inspections[0].status, "Draft", "nothing measured yet");
  const measured = ams.updateInspection(state, inspection.id, { joints: [{ no: 1, values: { "Box OD": 6.25, "Bevel diameter": 6.5 }, visual: "pass" }, { no: 2, values: { "Box OD": 6.1 }, visual: "pending" }] });
  const submitted = ams.submitInspection(measured, inspection.id);
  assert.equal(submitted.inspections[0].status, "Submitted");
  const issued = ams.approveInspection(submitted, inspection.id, "2027-04-23", "Reviewer");
  assert.equal(issued.inspections[0].status, "Issued", "a report issues with its rejects listed");
  assert.equal(issued.records[0].certificates.length, 1);
  assert.equal(issued.activity[0].event, "Report issued");
});

test("a new browser opens on the sample jobs, and that workspace survives a save and reload", () => {
  const state = ams.amsInitialState("2026-10-23");
  assert.ok(ams.validateStoredState(JSON.parse(JSON.stringify(state))));
  assert.deepEqual(state.inspections.map((item) => item.status).sort(), ["Draft", "Issued"]);
  const draft = state.inspections.find((item) => item.status === "Draft")!;
  const summary = ams.summarizeTally(draft.connection!, draft.joints!);
  assert.deepEqual({ premium: summary.premium, reject: summary.reject, pending: summary.pending }, { premium: 32, reject: 4, pending: 4 });
  assert.equal(ams.loadState(undefined, "2026-10-23").state.inspections.length, 2);
});
