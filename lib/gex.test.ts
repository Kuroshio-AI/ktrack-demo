import assert from "node:assert/strict";
import test, { before } from "node:test";
import type { AlloySpec, AppState, GexLot } from "./types";

// The GEX build is chosen at build time; node --test runs each file in its own process, so setting it here touches no other test.
process.env.NEXT_PUBLIC_CLIENT = "gex";
let gex: typeof import("./domain") & typeof import("./gex") & typeof import("./gex-check") & typeof import("./storage");
before(async () => { gex = { ...await import("./domain"), ...await import("./gex"), ...await import("./gex-check"), ...await import("./storage") }; });

const DATE = "2026-11-09";
const TIME = "2026-11-09T08:00:00.000Z";
const spec: AlloySpec = { id: "a1", alloy: "6063", temper: "T6", limits: [{ column: "si", min: 0.25, max: 0.55 }, { column: "tensile", min: 205 }, { column: "coat", min: 60, max: 120 }] };
const lot = (patch: Partial<GexLot> = {}): GexLot => ({ customer: "C", orderNo: "SO", customerPo: "PO", deliveryNote: "DN", profile: "P", finish: "Powder coated", lengthMm: 6000, quantity: 10, castNo: "K", spec, readings: { si: 0.4, tensile: 220, coat: 80 }, checks: { dimensions: true, surface: true, adhesion: true }, ...patch });
const seed = () => gex.gexInitialState(DATE, TIME);
const lotNo = (state: AppState, no: string) => state.inspections.find((item) => state.records.find((record) => record.id === item.assetId)?.assetRef === `LOT-26-${no}`)!;

test("checkLot passes in-range results and flags the rest by name", () => {
  assert.equal(gex.checkLot(lot()).conforming, true);
  assert.equal(gex.checkLot(lot({ readings: { si: 0.5504, tensile: 204.9996, coat: 120.0004 } })).conforming, true, "on the limit, at three decimals");
  assert.deepEqual(gex.checkLot(lot({ readings: { si: 0.2, tensile: 220, coat: 121 } })).failed, ["Si", "Coating thickness (mean)"]);
  const missing = gex.checkLot(lot({ readings: { si: 0.4, coat: 80 } }));
  assert.deepEqual([missing.pending, missing.complete, missing.conforming], [1, false, false]);
  assert.equal(gex.checkLot(lot({ checks: { dimensions: true, surface: false, adhesion: true } })).conforming, false, "a check answered Not OK");
});

test("finish rows and conductivity apply only where they belong", () => {
  const mill = gex.checkLot(lot({ finish: "Mill", readings: { si: 0.4, tensile: 220 } }));
  assert.deepEqual([mill.conforming, mill.rows.some((row) => row.key === "coat")], [true, false], "coat is ignored for Mill");
  const anodised = gex.checkLot(lot({ finish: "Anodised", readings: { si: 0.4, tensile: 220 } }));
  assert.ok(anodised.checks.some((check) => check.key === "seal") && !anodised.complete, "anodised lots answer the sealing check");
  const byId = (id: string) => gex.SAMPLE_ALLOYS.find((item) => item.id === id)!;
  assert.ok(gex.checkLot(lot({ spec: byId("6101-T6"), finish: "Mill" })).rows.some((row) => row.key === "conductivity"));
  assert.ok(!gex.checkLot(lot({ spec: byId("6063-T6"), finish: "Mill" })).rows.some((row) => row.key === "conductivity"));
  assert.deepEqual(["0.25–0.55", "≥ 205", "≤ 0.30", "—"], [gex.limitText({ min: 0.25, max: 0.55 }), gex.limitText({ min: 205 }), gex.limitText({ max: 0.3 }), gex.limitText({})]);
});

test("createLot refuses a duplicate lot number and an unknown alloy, and numbers follow the highest", () => {
  const state = seed();
  assert.equal(gex.nextLotNo(state), "LOT-26-0107");
  const input = { lotNo: "lot-26-0101", customer: "C", orderNo: "SO", customerPo: "PO", deliveryNote: "DN", profile: "P", alloyId: "6063-T6", finish: "Mill" as const, lengthMm: 6000, quantity: 5, castNo: "K", inspector: "" };
  assert.throws(() => gex.createLot(state, input), /already exists/);
  assert.throws(() => gex.createLot(state, { ...input, lotNo: "LOT-26-0107", alloyId: "7075-T6" }), /alloy-temper/);
  const created = gex.createLot(state, { ...input, lotNo: "LOT-26-0107" }, "Admin", TIME);
  assert.deepEqual([created.inspection.status, created.inspection.lot!.spec.id, gex.nextLotNo(created.state)], ["Draft", "6063-T6", "LOT-26-0108"]);
});

test("a non-conforming lot never issues until it is retested", () => {
  let state = seed();
  const fifth = lotNo(state, "0105");
  assert.equal(gex.approveInspection(state, fifth.id, "2036-11-09", "Reviewer", TIME), state);
  state = gex.returnInspection(state, fifth.id, "Retest elongation and coating.", "Reviewer", TIME);
  state = gex.updateInspection(state, fifth.id, { lot: { ...fifth.lot!, readings: { ...fifth.lot!.readings, elongation: 9.1, coat: 95 } } }, TIME);
  state = gex.approveInspection(gex.submitInspection(state, fifth.id, TIME), fifth.id, "2036-11-09", "Reviewer", TIME);
  assert.equal(state.inspections.find((item) => item.id === fifth.id)!.status, "Issued");
});

test("the seed has 3 valid and 1 superseded certificates, two lots waiting and a draft, and survives storage", () => {
  const state = seed();
  const certificates = state.records.flatMap((record) => record.certificates);
  assert.deepEqual([certificates.length, certificates.filter((item) => item.status === "Valid").length, certificates.filter((item) => item.status === "Superseded").length], [4, 3, 1]);
  const lots = state.inspections.filter((item) => item.lot);
  assert.deepEqual(lots.filter((item) => item.status === "Submitted").map((item) => gex.checkLot(item.lot!).conforming).sort(), [false, true]);
  assert.deepEqual(gex.checkLot(lotNo(state, "0105").lot!).failed, ["Elongation", "Coating thickness (mean)"]);
  const draft = lots.filter((item) => item.status === "Draft");
  assert.ok(draft.length === 1 && !gex.checkLot(draft[0].lot!).complete);
  assert.equal(JSON.stringify(seed().inspections.map((item) => item.lot)), JSON.stringify(lots.map((item) => item.lot)), "readings are repeatable");
  assert.equal(gex.validateStoredState(JSON.parse(JSON.stringify(state))), true);
  assert.equal(gex.loadState(undefined, DATE).state.alloys!.length, 5);
  const painted = { ...state, inspections: state.inspections.map((item) => item.lot ? { ...item, lot: { ...item.lot, finish: "Painted" } } : item) };
  assert.equal(gex.validateStoredState(JSON.parse(JSON.stringify(painted))), false);
  for (const item of lots) assert.ok(JSON.stringify(gex.gexSummary(item.lot!)).length <= 260);
  assert.equal(gex.customerTotals(state).length, 5);
});

test("a long or odd customer name still gives a summary the token accepts", async () => {
  const { isTokenSummary } = await import("./tokens");
  assert.equal(isTokenSummary(gex.gexSummary(lot({ customer: "Emirates Advanced Aluminium Facade Systems Trading LLC", customerPo: "A<B>\u0007", castNo: "<>" }))), true);
});

test("a workspace from older sample lots opens on the current ones; a current one is kept", () => {
  const seed = gex.gexInitialState(DATE, "2026-11-01T08:00:00.000Z");
  const old = { ...seed, gexSeed: undefined, records: seed.records.map((record) => ({ ...record, owner: "Old customer" })) };
  const opened = gex.loadState({ getItem: () => JSON.stringify(old) }, DATE);
  assert.equal(opened.state.gexSeed, gex.GEX_SEED);
  assert.ok(!JSON.stringify(opened.state).includes("Old customer"));
  assert.equal(opened.error, undefined);
  const edited = { ...seed, records: seed.records.map((record, index) => index ? record : { ...record, owner: "Edited here" }) };
  assert.ok(JSON.stringify(gex.loadState({ getItem: () => JSON.stringify(edited) }, DATE).state).includes("Edited here"));
});
