import { strict as assert } from "node:assert";
import test from "node:test";
import { amsInitialState } from "./ams";
import { customerShipments, shipmentTotals } from "./customer";
import { FINAL_CLASSES } from "./tally";

// The AMS sample: WO-2026-0391 issued with 24 pipes, WO-2026-0422 still being measured.
const state = amsInitialState("2026-10-30", "2026-10-30T08:00:00.000Z");

test("a shipment is classed only once its report is issued, with every pipe in one class", () => {
  const [newest, older] = customerShipments(state).sort((a, b) => Number(Boolean(b.certificate)) - Number(Boolean(a.certificate)));
  assert.equal(newest.record.assetRef, "WO-2026-0391");
  assert.equal(newest.status, "Valid");
  assert.equal(FINAL_CLASSES.reduce((sum, cls) => sum + newest.classes[cls], 0), 24);
  assert.equal(older.record.assetRef, "WO-2026-0422");
  assert.equal(older.certificate, undefined);
  assert.equal(older.measured, 38, "two pipes still to measure");
  assert.ok(FINAL_CLASSES.every((cls) => older.classes[cls] === 0), "no classes before the report");
});

test("totals leave out revoked and superseded reports", () => {
  const shipments = customerShipments(state);
  assert.equal(shipmentTotals(shipments).pipes, 24);
  const revoked = shipments.map((item) => item.certificate ? { ...item, status: "Revoked" as const } : item);
  assert.deepEqual(shipmentTotals(revoked), { ...shipmentTotals([]), shipments: 0 });
});
