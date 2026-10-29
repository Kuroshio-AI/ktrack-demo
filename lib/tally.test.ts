import assert from "node:assert/strict";
import test from "node:test";
import { pickConnection } from "./tally";
import type { ConnectionSpec } from "./types";

const row = (size: string, weight: string, connection: string, grade: string): ConnectionSpec => ({ id: `${size}-${weight}-${connection}-${grade}`, size, weight, connection, grade, limits: [] });
const specs = [row("5", "19.50", "XT 50", "G"), row("5", "19.50", "XT 50", "S"), row("5", "25.60", "XT 50", "G"), row("4 1/2", "16.60", "XT 46", "S"), row("6 5/8", "27.70", "XT 65", "S"), row("2 7/8", "10.40", "XT-M26", "G")];

test("the connection picker narrows one field at a time and keeps later choices where it can", () => {
  const start = pickConnection(specs, {});
  assert.deepEqual(start.steps[0].options, ["2 7/8", "4 1/2", "5", "6 5/8"]);
  assert.equal(start.spec?.id, "2 7/8-10.40-XT-M26-G");
  const fiveS = pickConnection(specs, { size: "5", weight: "19.50", connection: "XT 50", grade: "S" });
  assert.equal(fiveS.spec?.id, "5-19.50-XT 50-S");
  assert.deepEqual(fiveS.steps.map((step) => step.options.length), [4, 2, 1, 2]);
  // 6 5/8 comes in S, so the grade survives the size change; 25.60 has no S, so it falls back to G.
  assert.equal(pickConnection(specs, { ...fiveS.spec, size: "6 5/8" }).spec?.id, "6 5/8-27.70-XT 65-S");
  assert.equal(pickConnection(specs, { ...fiveS.spec, weight: "25.60" }).spec?.id, "5-25.60-XT 50-G");
  assert.equal(pickConnection([], {}).spec, undefined);
});
