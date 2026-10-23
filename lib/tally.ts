import type { ConnectionSpec, Equipment, FinalClass, Inspection, Joint, Limit, TallyJob } from "./types";

// The F.582 drill pipe tally sheet, column for column. "limit" names the dimension table column a reading is checked
// against; the remaining wall is checked against the job's nominal wall instead. Codes come from the form's abbreviations.
export type Group = "Pipe body" | "Box tool joint" | "Pin tool joint";
export type TallyColumn = { key: string; label: string; name: string; group: Group; kind: "number" | "code" | "coating" | "class"; limit?: string; required?: boolean };

export const TALLY_COLUMNS: TallyColumn[] = [
  { key: "length", label: "Length (ft)", name: "Length", group: "Pipe body", kind: "number", required: true },
  { key: "coating", label: "ID coating", name: "ID coating condition", group: "Pipe body", kind: "coating" },
  { key: "odCond", label: "OD cond / STNS", name: "OD condition", group: "Pipe body", kind: "code" },
  { key: "remWall", label: "Rem. wall", name: "Remaining wall", group: "Pipe body", kind: "number", required: true },
  { key: "finalClass", label: "Final class", name: "Final class", group: "Pipe body", kind: "class" },
  { key: "boxShoulder", label: "Shoul. width / C'bore thick", name: "Box shoulder width / c'bore thickness", group: "Box tool joint", kind: "number", limit: "C'bore wall" },
  { key: "cboreDepth", label: "C'bore depth", name: "Counterbore depth", group: "Box tool joint", kind: "number" },
  { key: "cboreDia", label: "C'bore dia.", name: "Counterbore diameter", group: "Box tool joint", kind: "number", limit: "Box c'bore diameter" },
  { key: "boxTong", label: "Tong space", name: "Box tong space", group: "Box tool joint", kind: "number", limit: "Tong space box" },
  { key: "boxBevel", label: "Bevel dia.", name: "Box bevel diameter", group: "Box tool joint", kind: "number", limit: "Bevel diameter" },
  { key: "boxConn", label: "Conn. length", name: "Box connection length", group: "Box tool joint", kind: "number", limit: "Box connection length" },
  { key: "boxOd", label: "Box OD", name: "Box OD", group: "Box tool joint", kind: "number", limit: "Box OD" },
  { key: "boxHb", label: "H.B cond.", name: "Box hardband", group: "Box tool joint", kind: "code" },
  { key: "heatCheck", label: "Heat check", name: "Heat check", group: "Box tool joint", kind: "code" },
  { key: "boxCond", label: "Box cond.", name: "Box condition", group: "Box tool joint", kind: "code" },
  { key: "boxMpi", label: "MPI/UT slip & upset", name: "Box MPI/UT slip & upset", group: "Box tool joint", kind: "code" },
  { key: "pinId", label: "ID", name: "Pin ID", group: "Pin tool joint", kind: "number" },
  { key: "pinTong", label: "Tong space", name: "Pin tong space", group: "Pin tool joint", kind: "number", limit: "Tong space pin" },
  { key: "pinBevel", label: "Bevel dia.", name: "Pin bevel diameter", group: "Pin tool joint", kind: "number", limit: "Bevel diameter" },
  { key: "pinConn", label: "Conn. length", name: "Pin connection length", group: "Pin tool joint", kind: "number", limit: "Pin connection length" },
  { key: "pinNose", label: "Pin nose dia.", name: "Pin nose diameter", group: "Pin tool joint", kind: "number", limit: "Pin nose diameter" },
  { key: "pinCyl", label: "Pin cyl. dia.", name: "Pin cylinder diameter", group: "Pin tool joint", kind: "number" },
  { key: "lead", label: "Lead", name: "Lead", group: "Pin tool joint", kind: "number" },
  { key: "neck", label: "Neck length", name: "Neck length", group: "Pin tool joint", kind: "number" },
  { key: "pinHb", label: "H.B cond.", name: "Pin hardband", group: "Pin tool joint", kind: "code" },
  { key: "pinCond", label: "Pin cond.", name: "Pin condition", group: "Pin tool joint", kind: "code" },
  { key: "pinMpi", label: "MPI/UT slip & upset", name: "Pin MPI/UT slip & upset", group: "Pin tool joint", kind: "code" },
];

// The form's abbreviations. RFD (re-faced) is a field repair, not a defect; BENT stands in for a failed straightness check.
export const CODES: Record<string, string> = {
  OK: "No defect", SD: "Shoulder damaged", TD: "Thread damaged", PT: "Pitted thread", PS: "Pitted seal", NFS: "Non-flat shoulder", ST: "Stretched thread",
  GT: "Galled thread", OT: "Over-torqued", GS: "Galled shoulder", RFD: "Re-faced", IE: "Internal erosion", IC: "Internal corrosion", BB: "Belled box", CRK: "Cracked", BENT: "Bent",
};

export const FINAL_CLASSES: FinalClass[] = ["Class 1 (New)", "Class 1-Rework", "Premium-Accepted", "Premium-Rework", "Class-2", "Bent", "Scrap"];

// API RP 7G-2 tube classes by remaining wall: Premium keeps 80% of nominal, Class 2 keeps 70%.
const PREMIUM_WALL = 0.8;
const CLASS2_WALL = 0.7;

export const thou = (value: number) => Math.round(value * 1000) / 1000;
export const inches = (value: number) => value.toFixed(3);
export const readingText = (column: TallyColumn, value: number) => column.key === "length" ? value.toFixed(2) : inches(value);

export type Failure = { column: TallyColumn; value: number; limit: number; side: "min" | "max" };

export function limitFor(column: TallyColumn, spec: ConnectionSpec, job: Pick<TallyJob, "nominalWall">): Limit | undefined {
  if (column.key === "remWall") return { column: "Remaining wall", min: thou(job.nominalWall * PREMIUM_WALL) };
  return column.limit ? spec.limits.find((limit) => limit.column === column.limit) : undefined;
}

// Gauges read to a thousandth of an inch, so compare at three decimals; a value on the limit passes.
export function limitFailure(column: TallyColumn, limit: Limit | undefined, value: number | undefined): Failure | undefined {
  if (!limit || value === undefined) return undefined;
  if (limit.min !== undefined && thou(value) < thou(limit.min)) return { column, value, limit: limit.min, side: "min" };
  if (limit.max !== undefined && thou(value) > thou(limit.max)) return { column, value, limit: limit.max, side: "max" };
  return undefined;
}

export const isDefect = (code: string | undefined) => Boolean(code && code !== "OK" && code !== "RFD");

export type Side = "box" | "pin" | "both" | "other";
export type Graded = { suggested: FinalClass | "Pending"; final: FinalClass | "Pending"; failures: Failure[]; defects: { column: TallyColumn; code: string }[]; rework?: Side; repaired?: Side };

// KTrack suggests a final class and the inspector confirms or changes it. The suggestion only uses what the form and the
// dimension table say: a crack scraps the pipe; remaining wall under 70% scraps it and under 80% makes it Class 2; a box OD
// under the Premium minimum makes it Class 2; a bent pipe is Bent; any other failed limit or defect code means Premium rework.
export function gradePipe(spec: ConnectionSpec, job: Pick<TallyJob, "nominalWall">, joint: Joint): Graded {
  const failures: Failure[] = [];
  let missing = false;
  for (const column of TALLY_COLUMNS) {
    if (column.kind !== "number") continue;
    const limit = limitFor(column, spec, job);
    const value = joint.values[column.key];
    if (value === undefined) { if (column.required || limit) missing = true; continue; }
    const failure = limitFailure(column, limit, value);
    if (failure) failures.push(failure);
  }
  const defects = TALLY_COLUMNS.filter((column) => column.kind === "code" && isDefect(joint.codes[column.key])).map((column) => ({ column, code: joint.codes[column.key] }));
  const wall = joint.values.remWall;
  const issue = (group: Group) => failures.some((failure) => failure.column.group === group) || defects.some((defect) => defect.column.group === group);
  const box = issue("Box tool joint");
  const pin = issue("Pin tool joint");
  const repairedBox = joint.codes.boxCond === "RFD" || joint.codes.boxHb === "RFD";
  const repairedPin = joint.codes.pinCond === "RFD" || joint.codes.pinHb === "RFD";
  const suggested: FinalClass | "Pending" = defects.some((defect) => defect.code === "CRK") || (wall !== undefined && thou(wall) < thou(job.nominalWall * CLASS2_WALL)) ? "Scrap"
    : failures.some((failure) => failure.column.key === "remWall" || failure.column.key === "boxOd") ? "Class-2"
    : joint.codes.odCond === "BENT" ? "Bent"
    : failures.length || defects.length ? "Premium-Rework"
    : missing ? "Pending" : "Premium-Accepted";
  return {
    suggested,
    final: joint.finalClass ?? suggested,
    failures,
    defects,
    rework: box && pin ? "both" : box ? "box" : pin ? "pin" : issue("Pipe body") ? "other" : undefined,
    repaired: repairedBox ? "box" : repairedPin ? "pin" : undefined,
  };
}

// "Box tong space 8.190, min 8.250" or "Box condition TD (Thread damaged)"
export const failureText = ({ column, value, limit, side }: Failure) => `${column.name} ${readingText(column, value)}, ${side} ${inches(limit)}`;
export const defectText = ({ column, code }: { column: TallyColumn; code: string }) => `${column.name} ${code}${CODES[code] ? ` (${CODES[code].toLowerCase()})` : ""}`;
export const reasons = (graded: Graded) => [...graded.failures.map(failureText), ...graded.defects.map(defectText)];

export const limitText = ({ min, max }: Limit) => min !== undefined && max !== undefined ? `${inches(min)} to ${inches(max)}` : min !== undefined ? `min ${inches(min)}` : max !== undefined ? `max ${inches(max)}` : "";

export const connectionLabel = (spec: Pick<ConnectionSpec, "size" | "weight" | "connection" | "grade">) => `${spec.size}" ${spec.weight} ${spec.connection} grade ${spec.grade}`;

// The F.581 results table: one row per class, each split by where rework is needed and what was repaired in the field.
export type ResultRow = { label: string; count: number; rework: Record<Side, number>; repaired: Record<"box" | "pin" | "other", number> };
export type TallySummary = { total: number; pending: number; accepted: number; rows: ResultRow[]; downgraded: { joint: Joint; graded: Graded }[] };

export function summarizeTally(spec: ConnectionSpec, job: Pick<TallyJob, "nominalWall">, joints: Joint[]): TallySummary {
  const graded = joints.map((joint) => ({ joint, graded: gradePipe(spec, job, joint) }));
  const row = (label: string, items: typeof graded): ResultRow => ({
    label, count: items.length,
    rework: { box: items.filter(({ graded: g }) => g.rework === "box").length, pin: items.filter(({ graded: g }) => g.rework === "pin").length, both: items.filter(({ graded: g }) => g.rework === "both").length, other: items.filter(({ graded: g }) => g.rework === "other").length },
    repaired: { box: items.filter(({ graded: g }) => g.repaired === "box").length, pin: items.filter(({ graded: g }) => g.repaired === "pin").length, other: 0 },
  });
  const done = graded.filter(({ graded: g }) => g.final !== "Pending");
  return {
    total: joints.length,
    pending: joints.length - done.length,
    accepted: done.filter(({ graded: g }) => g.final === "Premium-Accepted" || g.final === "Class 1 (New)").length,
    rows: [
      row("Total pipe inspected", done),
      ...FINAL_CLASSES.map((cls) => row(cls, done.filter(({ graded: g }) => g.final === cls))),
      row("ID coating cond. 3 & 4", done.filter(({ joint }) => (joint.coating ?? 0) >= 3)),
    ],
    downgraded: done.filter(({ graded: g }) => g.final !== "Premium-Accepted" && g.final !== "Class 1 (New)"),
  };
}

export const tallyComplete = (inspection: Pick<Inspection, "connection" | "job" | "joints">) =>
  Boolean(inspection.connection && inspection.job && inspection.joints?.length && inspection.joints.every((joint) => gradePipe(inspection.connection!, inspection.job!, joint).final !== "Pending"));

export type Calibration = "Valid" | "Due soon" | "Expired";
export function calibrationStatus(item: Pick<Equipment, "calibrationDue">, date: string): Calibration {
  if (item.calibrationDue < date) return "Expired";
  return Date.parse(item.calibrationDue) - Date.parse(date) <= 30 * 86_400_000 ? "Due soon" : "Valid";
}
// A tally sheet can't go for approval while any instrument it lists is past its calibration date.
export const expiredEquipment = (equipment: Equipment[], ids: string[], date: string) => equipment.filter((item) => ids.includes(item.id) && calibrationStatus(item, date) === "Expired");

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isOptionalNumber = (value: unknown) => value === undefined || isNumber(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isTextList = (value: unknown) => Array.isArray(value) && value.every(isText);
const isDate = (value: unknown) => isText(value) && /^\d{4}-\d{2}-\d{2}$/.test(value);

export function isConnectionSpec(value: unknown): value is ConnectionSpec {
  if (!value || typeof value !== "object") return false;
  const spec = value as Partial<ConnectionSpec>;
  return [spec.id, spec.size, spec.weight, spec.connection, spec.grade].every(isText)
    && (spec.sample === undefined || typeof spec.sample === "boolean")
    && Array.isArray(spec.limits) && spec.limits.every((limit) => Boolean(limit && typeof limit === "object" && isText(limit.column) && isOptionalNumber(limit.min) && isOptionalNumber(limit.max)));
}

export function isJoint(value: unknown): value is Joint {
  if (!value || typeof value !== "object") return false;
  const joint = value as Partial<Joint>;
  const isMap = (map: unknown, check: (item: unknown) => boolean) => Boolean(map && typeof map === "object" && !Array.isArray(map) && Object.values(map).every(check));
  return Number.isSafeInteger(joint.no) && (joint.serial === undefined || isText(joint.serial))
    && isMap(joint.values, isNumber) && isMap(joint.codes, isText)
    && (joint.coating === undefined || [1, 2, 3, 4].includes(joint.coating))
    && (joint.finalClass === undefined || FINAL_CLASSES.includes(joint.finalClass));
}

export function isEquipment(value: unknown): value is Equipment {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Equipment>;
  return [item.id, item.kind, item.model, item.serial].every(isText) && isDate(item.calibrationDue);
}

export function isTallyJob(value: unknown): value is TallyJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<TallyJob>;
  return [job.well, job.location, job.range, job.standard, job.serviceCategory].every(isText) && isNumber(job.nominalWall) && job.nominalWall > 0
    && [job.toolJointOd, job.pinId, job.hardBand].every((item) => item === undefined || isText(item))
    && isTextList(job.program) && isTextList(job.services) && isTextList(job.equipmentIds)
    && (job.equipment === undefined || (Array.isArray(job.equipment) && job.equipment.every(isEquipment)));
}
