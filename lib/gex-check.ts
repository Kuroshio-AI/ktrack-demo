import { thou } from "./tally";
import type { AlloySpec, GexCheck, GexFinish, GexLot } from "./types";

// GEX: what a production lot is tested for and how a result is checked against its alloy-temper's limits. A leaf module:
// domain.ts imports it, so it must never import domain.ts.
export type GexGroup = "Composition" | "Mechanical" | "Electrical" | "Finish";
export type GexReading = { key: string; label: string; unit: string; group: GexGroup; finish?: GexFinish };

const element = (key: string, label: string): GexReading => ({ key, label, unit: "%", group: "Composition" });
export const GEX_READINGS: GexReading[] = [
  element("si", "Si"), element("fe", "Fe"), element("cu", "Cu"), element("mn", "Mn"), element("mg", "Mg"), element("cr", "Cr"), element("zn", "Zn"), element("ti", "Ti"),
  { key: "tensile", label: "Tensile strength", unit: "MPa", group: "Mechanical" },
  { key: "proof", label: "Proof stress", unit: "MPa", group: "Mechanical" },
  { key: "elongation", label: "Elongation", unit: "%", group: "Mechanical" },
  { key: "hardness", label: "Hardness", unit: "HB", group: "Mechanical" },
  { key: "conductivity", label: "Conductivity", unit: "MS/m", group: "Electrical" },
  { key: "coat", label: "Coating thickness (mean)", unit: "µm", group: "Finish", finish: "Powder coated" },
  { key: "gloss", label: "Gloss", unit: "GU", group: "Finish", finish: "Powder coated" },
  { key: "anodic", label: "Anodic film (mean)", unit: "µm", group: "Finish", finish: "Anodised" },
];

export const GEX_CHECKS: { key: GexCheck; label: string; finish?: GexFinish }[] = [
  { key: "dimensions", label: "Dimensional check (5 pcs)" },
  { key: "surface", label: "Visual inspection" },
  { key: "adhesion", label: "Adhesion (cross-cut)", finish: "Powder coated" },
  { key: "seal", label: "Sealing quality (dye spot)", finish: "Anodised" },
];

export const GEX_FINISHES: GexFinish[] = ["Mill", "Powder coated", "Anodised"];
export const alloyLabel = (spec: Pick<AlloySpec, "alloy" | "temper">) => `${spec.alloy}-${spec.temper}`;

// ok undefined = not measured.
export type LotRow = GexReading & { min?: number; max?: number; value?: number; ok?: boolean };
export type LotCheck = { rows: LotRow[]; checks: { key: GexCheck; label: string; value?: boolean }[]; failed: string[]; pending: number; complete: boolean; conforming: boolean };

const applies = (finish: GexFinish) => (item: { finish?: GexFinish }) => !item.finish || item.finish === finish;

// A reading is tested only when the lot's spec has a limit for it and it fits the finish, so conductivity counts only where
// the alloy-temper limits it. Results compare at three decimals and a value on the limit passes, as limitFailure does.
export function checkLot(lot: Pick<GexLot, "spec" | "finish" | "readings" | "checks">): LotCheck {
  const rows = GEX_READINGS.filter(applies(lot.finish)).flatMap((reading): LotRow[] => {
    const limit = lot.spec.limits.find((item) => item.column === reading.key && (item.min !== undefined || item.max !== undefined));
    if (!limit) return [];
    const value = lot.readings[reading.key];
    const ok = value === undefined ? undefined : !(limit.min !== undefined && thou(value) < thou(limit.min)) && !(limit.max !== undefined && thou(value) > thou(limit.max));
    return [{ ...reading, min: limit.min, max: limit.max, value, ok }];
  });
  const checks = GEX_CHECKS.filter(applies(lot.finish)).map(({ key, label }) => ({ key, label, value: lot.checks[key] }));
  const failed = [...rows.filter((row) => row.ok === false).map((row) => row.label), ...checks.filter((check) => check.value === false).map((check) => check.label)];
  const pending = rows.filter((row) => row.value === undefined).length + checks.filter((check) => check.value === undefined).length;
  return { rows, checks, failed, pending, complete: pending === 0, conforming: pending === 0 && failed.length === 0 };
}

// Exported so the certificate can print min and max in their own columns.
export const limitNumber = (value: number) => Math.abs(value) < 1 ? value.toFixed(2) : String(value);
export const limitText = (row: { min?: number; max?: number }) => row.min !== undefined && row.max !== undefined ? `${limitNumber(row.min)}–${limitNumber(row.max)}` : row.min !== undefined ? `≥ ${limitNumber(row.min)}` : row.max !== undefined ? `≤ ${limitNumber(row.max)}` : "—";

const isText = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isPlain = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const CHECK_KEYS = new Set<string>(GEX_CHECKS.map((check) => check.key));

export function isAlloySpec(value: unknown): value is AlloySpec {
  if (!isPlain(value)) return false;
  const spec = value as Partial<AlloySpec>;
  return [spec.id, spec.alloy, spec.temper].every(isText) && (spec.sample === undefined || typeof spec.sample === "boolean")
    && Array.isArray(spec.limits) && spec.limits.every((limit) => isPlain(limit) && isText(limit.column) && [limit.min, limit.max].every((item) => item === undefined || isNumber(item)));
}

export function isGexLot(value: unknown): value is GexLot {
  if (!isPlain(value)) return false;
  const lot = value as Partial<GexLot>;
  return [lot.customer, lot.orderNo, lot.customerPo, lot.deliveryNote, lot.profile, lot.castNo].every(isText) && GEX_FINISHES.includes(lot.finish as GexFinish)
    && (lot.colour === undefined || isText(lot.colour)) && isNumber(lot.lengthMm) && lot.lengthMm > 0 && Number.isSafeInteger(lot.quantity) && lot.quantity! > 0
    && isAlloySpec(lot.spec) && isPlain(lot.readings) && Object.values(lot.readings).every(isNumber)
    && isPlain(lot.checks) && Object.entries(lot.checks).every(([key, item]) => CHECK_KEYS.has(key) && typeof item === "boolean");
}
