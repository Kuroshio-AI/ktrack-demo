import assert from "node:assert/strict";
import test from "node:test";
import { formatFix, obligationFor, siteFor, subseaChecklist } from "./safeen";

const kit = (assetType: string) => obligationFor({ assetType, recordType: "equipment" });

test("each kind of subsea equipment owes the right thing", () => {
  assert.equal(kit("ROV UT thickness gauge · Cygnus").due, "Calibration due");
  assert.equal(kit("Torque tool Class 1-4 · FET").due, "Calibration due");
  assert.equal(kit("USBL transponder · Kongsberg cNODE MiniS").due, "Verification due");
  assert.equal(kit("ROV LARS, A-frame and winch · Dynacon").due, "Thorough examination due");
  assert.equal(kit("Manipulator, 7-function · Schilling Titan 4").due, "Service due");
  assert.equal(kit("Work-class ROV · SMD Quasar MkII").due, "ROV system inspection due");
  assert.equal(kit("Diving helmet · Kirby Morgan KM 77").reference, "IMCA D 018");
  assert.equal(kit("Positioning verification (mobilisation)").reference, "IOGP 624-01 · IMCA S 017");
  assert.equal(kit("Deck lighting").due, "Inspection due");
  // R 011 is ROV launch and recovery only.
  assert.equal(kit("Diver LARS and basket").reference, "IMCA D 018 · LOLER reg. 9");
  assert.equal(kit("Offshore crane, 80 t AHC").reference, "LOLER reg. 9 · DNV-ST-0378");
  assert.equal(kit("Lifting slings and shackles set").reference, "LOLER reg. 9");
  assert.equal(kit("Towing winch").due, "Towing gear survey due");
  assert.equal(kit("Pipe tracker · Teledyne TSS 440").reference, "OEM calibration procedure");
  assert.equal(kit("Multibeam echosounder").document, "Calibration check record");
});

test("crew tickets get a certificate check, never an ROV pre-dive list", () => {
  const ticket = { assetType: "ROV pilot technician · H2S (OPITO 9014)", recordType: "licence" as const };
  assert.equal(obligationFor(ticket).due, "Certificate expiry");
  assert.match(subseaChecklist(ticket)[0], /Original certificate/);
  for (const [type] of [["Work-class ROV"], ["Survey spread positioning verification"]]) assert.ok(kit(type).checklist.length <= 12);
});

test("fixes read like a survey log and sites match by name", () => {
  assert.equal(formatFix(24.842, 53.661), "24°50.52′N 053°39.66′E");
  assert.equal(siteFor(" safeen surveyor ")?.kind, "Vessel");
  assert.equal(siteFor("Somewhere else"), undefined);
});

test("the full SAFEEN demo leaves every screen something to show", async () => {
  const { subseaDemo, subseaRows } = await import("./safeen-sample");
  const state = subseaDemo("2026-11-03");
  const ref = (assetRef: string) => state.records.find((record) => record.assetRef === assetRef)!;
  assert.equal(state.records.length, subseaRows("2026-11-03", "1").length);
  assert.equal(new Set(state.records.map((record) => record.assetRef)).size, state.records.length);
  assert.deepEqual(state.inspections.map((inspection) => `${ref(state.records.find((record) => record.id === inspection.assetId)!.assetRef).assetRef}:${inspection.status}`).sort(), ["BCN-08:Returned", "LARS-01:Submitted", "MBES-01:Returned", "ROV-01:Draft", "SLG-01:Issued"]);
  assert.equal(ref("BCN-08").redTag?.date, "2026-11-01");
  assert.equal(ref("SLG-01").inspectionDueDate, "2027-05-03");
  assert.ok(state.alerts.some((alert) => alert.assetRef === "BCN-08" && alert.status === "open" && alert.severity === "critical"));
  assert.equal(state.demoDate, "2026-11-03");
});

test("equipment can be taken out of service straight from the register", async () => {
  const { subseaDemo } = await import("./safeen-sample");
  const { nextDeadline, OUT_OF_SERVICE, redTagRecord } = await import("./domain");
  const state = subseaDemo("2026-11-03");
  const rov = state.records.find((record) => record.assetRef === "ROV-02")!;
  assert.equal(redTagRecord(state, rov.id, "  "), state);
  const tagged = redTagRecord(state, rov.id, "Thruster 3 seized on deck test.", "Engineer");
  const record = tagged.records.find((item) => item.id === rov.id)!;
  assert.deepEqual(record.redTag, { date: "2026-11-03", reason: "Thruster 3 seized on deck test." });
  assert.equal(nextDeadline(record, tagged.demoDate)?.event, OUT_OF_SERVICE);
  assert.ok(tagged.alerts.some((alert) => alert.assetRef === "ROV-02" && alert.status === "open" && alert.severity === "critical"));
  assert.equal(redTagRecord(tagged, rov.id, "again"), tagged);
});

test("a survey tally grades each point and holds the report while a gauge is out of calibration", async () => {
  const { subseaDemo } = await import("./safeen-sample");
  const { gradePoint, issueBlockers, issueSurvey, summarizeSurvey } = await import("./survey");
  const line = { nominalWall: 19.1, minWall: 15.2 };
  assert.deepEqual(gradePoint({ id: "a", kp: 0, cp: -1000, wall: 18.9, anode: 20, code: "OK" }, line), { result: "Accept", reasons: [], tags: [], findings: [] });
  assert.equal(gradePoint({ id: "b", kp: 0, cp: -800, code: "OK" }, line).result, "Accept");
  assert.equal(gradePoint({ id: "c", kp: 0, cp: -799, code: "OK" }, line).result, "Repair");
  assert.deepEqual(gradePoint({ id: "d", kp: 0, cp: -1000, wall: 16.1, code: "OK" }, line).tags, ["Wall 84%"]);
  assert.equal(gradePoint({ id: "e", kp: 0, cp: -1000, wall: 15.1, code: "OK" }, line).result, "Repair");
  assert.equal(gradePoint({ id: "f", kp: 0, wall: 18, code: "OK" }, line).result, "Pending");

  const state = subseaDemo("2026-11-03");
  const [riser, exportLine, lastYear] = state.surveys!;
  assert.deepEqual([lastYear.status, exportLine.status, riser.status], ["Issued", "Issued", "Draft"]);
  assert.deepEqual([lastYear.number, exportLine.number, riser.number], ["SVR-24-001", "SVR-26-001", "SVR-26-002"]);
  const summary = summarizeSurvey(riser);
  assert.deepEqual([summary.accept, summary.monitor, summary.repair, summary.pending], [3, 2, 1, 1]);
  assert.deepEqual(issueBlockers(riser, state), ["1 point has no CP reading yet.", "UTG-01 calibration is 10 days overdue."]);
  assert.equal(issueSurvey(state, riser.id, "Reviewer"), state);
});

test("issued campaigns file anomalies, match them year on year and close them out", async () => {
  const { subseaDemo } = await import("./safeen-sample");
  const { advanceAnomaly, compareSurveys, previousCampaign } = await import("./anomaly");
  const { gradePoint } = await import("./survey");
  const line = { nominalWall: 19.1, minWall: 15.2 };
  assert.equal(gradePoint({ id: "s", kp: 0, cp: -1000, code: "FS", length: 15 }, line).result, "Monitor");
  assert.equal(gradePoint({ id: "s", kp: 0, cp: -1000, code: "FS", length: 16 }, line).result, "Repair");
  assert.equal(gradePoint({ id: "a", kp: 0, cp: -1000, anode: 75, code: "OK" }, line).result, "Repair");

  const state = subseaDemo("2026-11-03");
  const byNumber = Object.fromEntries(state.anomalies!.map((item) => [item.number, item]));
  const span = byNumber["ANM-0231"];
  assert.deepEqual([span.kind, span.result, span.status, span.sightings.map((item) => item.measure)], ["Free span", "Repair", "Open", ["11 m long", "18 m long"]]);
  assert.deepEqual([byNumber["ANM-0230"].status, byNumber["ANM-0232"].status, byNumber["ANM-0233"].status], ["Closed", "Re-inspected", "Action planned"]);

  const [, now, before] = state.surveys!;
  assert.equal(previousCampaign(state.surveys!, now), before);
  const rows = compareSurveys(before, now);
  const count = (change: string) => rows.filter((row) => row.change === change).length;
  assert.deepEqual([count("New"), count("Worsened"), count("Unchanged"), count("Resolved")], [1, 6, 1, 2]);
  assert.deepEqual(rows.find((row) => row.item === "Free span"), { kp: 12.4, item: "Free span", before: "11 m", after: "18 m", change: "Worsened", result: "Repair" });

  // Only a reviewer closes out, and planning needs a note.
  const reinspected = byNumber["ANM-0232"].id;
  assert.equal(advanceAnomaly(state, reinspected, "Closed out", {}, "Engineer"), state);
  assert.equal(advanceAnomaly(state, span.id, " ", {}, "Reviewer"), state);
  const closed = advanceAnomaly(state, reinspected, "Re-inspection clear", {}, "Reviewer");
  assert.equal(closed.anomalies!.find((item) => item.id === reinspected)?.status, "Closed");
  const planned = advanceAnomaly(state, span.id, "Book DSV", { action: "Grout bags", target: "2026-12-15" }, "Reviewer");
  assert.deepEqual((({ status, action, target }) => ({ status, action, target }))(planned.anomalies!.find((item) => item.id === span.id)!), { status: "Action planned", action: "Grout bags", target: "2026-12-15" });
});
