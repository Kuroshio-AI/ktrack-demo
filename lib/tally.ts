import type { ConnectionSpec, DamageCriterion, DamageOutcome, Equipment, FinalClass, Inspection, Joint, Limit, TallyJob } from "./types";

// The F.582 drill pipe tally sheet, column for column. "limit" lists the dimension table columns a reading is checked
// against, under each name the client's tables use (DS-1 first, then API RP 7G-2); the remaining wall is checked against the
// job's nominal wall instead. Codes come from the form's abbreviations.
export type Group = "Pipe body" | "Box tool joint" | "Pin tool joint";
export type TallyColumn = { key: string; label: string; name: string; group: Group; kind: "number" | "code" | "coating" | "class"; limit?: string[]; required?: boolean };

export const TALLY_COLUMNS: TallyColumn[] = [
  { key: "length", label: "Length (ft)", name: "Length", group: "Pipe body", kind: "number", required: true },
  { key: "coating", label: "ID coating", name: "ID coating condition", group: "Pipe body", kind: "coating" },
  { key: "odCond", label: "OD cond / STNS", name: "OD condition", group: "Pipe body", kind: "code" },
  { key: "remWall", label: "Rem. wall", name: "Remaining wall", group: "Pipe body", kind: "number", required: true },
  { key: "finalClass", label: "Final class", name: "Final class", group: "Pipe body", kind: "class" },
  { key: "boxShoulder", label: "Shoul. width / C'bore thick", name: "Box shoulder width / c'bore thickness", group: "Box tool joint", kind: "number", limit: ["C'bore wall", "Box shoulder width"] },
  { key: "cboreDepth", label: "C'bore depth", name: "Counterbore depth", group: "Box tool joint", kind: "number", limit: ["C'bore depth", "Counterbore length"] },
  { key: "cboreDia", label: "C'bore dia.", name: "Counterbore diameter", group: "Box tool joint", kind: "number", limit: ["Box c'bore diameter", "Counterbore diameter"] },
  { key: "boxTong", label: "Tong space", name: "Box tong space", group: "Box tool joint", kind: "number", limit: ["Tong space box"] },
  { key: "boxBevel", label: "Bevel dia.", name: "Box bevel diameter", group: "Box tool joint", kind: "number", limit: ["Bevel diameter"] },
  { key: "boxConn", label: "Conn. length", name: "Box connection length", group: "Box tool joint", kind: "number", limit: ["Box connection length", "Box thread length"] },
  { key: "boxOd", label: "Box OD", name: "Box OD", group: "Box tool joint", kind: "number", limit: ["Box OD", "Tool joint OD"] },
  { key: "boxHb", label: "H.B cond.", name: "Box hardband", group: "Box tool joint", kind: "code" },
  { key: "heatCheck", label: "Heat check", name: "Heat check", group: "Box tool joint", kind: "code" },
  { key: "boxCond", label: "Box cond.", name: "Box condition", group: "Box tool joint", kind: "code" },
  { key: "boxMpi", label: "MPI/UT slip & upset", name: "Box MPI/UT slip & upset", group: "Box tool joint", kind: "code" },
  { key: "pinId", label: "ID", name: "Pin ID", group: "Pin tool joint", kind: "number", limit: ["Pin ID", "Tool joint ID"] },
  { key: "pinTong", label: "Tong space", name: "Pin tong space", group: "Pin tool joint", kind: "number", limit: ["Tong space pin"] },
  { key: "pinBevel", label: "Bevel dia.", name: "Pin bevel diameter", group: "Pin tool joint", kind: "number", limit: ["Bevel diameter"] },
  { key: "pinConn", label: "Conn. length", name: "Pin connection length", group: "Pin tool joint", kind: "number", limit: ["Pin connection length", "Pin length"] },
  { key: "pinNose", label: "Pin nose dia.", name: "Pin nose diameter", group: "Pin tool joint", kind: "number", limit: ["Pin nose diameter"] },
  { key: "pinCyl", label: "Pin cyl. dia.", name: "Pin cylinder diameter", group: "Pin tool joint", kind: "number" },
  { key: "lead", label: "Lead", name: "Lead", group: "Pin tool joint", kind: "number" },
  { key: "neck", label: "Neck length", name: "Neck length", group: "Pin tool joint", kind: "number", limit: ["Neck length", "Pin base length"] },
  { key: "pinHb", label: "H.B cond.", name: "Pin hardband", group: "Pin tool joint", kind: "code" },
  { key: "pinCond", label: "Pin cond.", name: "Pin condition", group: "Pin tool joint", kind: "code" },
  { key: "pinMpi", label: "MPI/UT slip & upset", name: "Pin MPI/UT slip & upset", group: "Pin tool joint", kind: "code" },
];

// The form's abbreviations. BENT stands in for a failed straightness check. What each one does to the pipe comes from the
// damage criteria below.
export const CODES: Record<string, string> = {
  OK: "No defect", SD: "Shoulder damaged", TD: "Thread damaged", PT: "Pitted thread", PS: "Pitted seal", NFS: "Non-flat shoulder", ST: "Stretched thread",
  GT: "Galled thread", OT: "Over-torqued", GS: "Galled shoulder", RFD: "Re-faced", IE: "Internal erosion", IC: "Internal corrosion", BB: "Belled box", CRK: "Cracked", BENT: "Bent",
};

export const DAMAGE_OUTCOMES: DamageOutcome[] = ["Field repair", "Rework", "Class 2", "Bent", "Scrap"];

// Made-up wording for the public demo, marked sample: the client's procedure replaces it on the Damage criteria page.
export const SAMPLE_CRITERIA: DamageCriterion[] = ([
  ["SD", "Dents, nicks or washouts on the make-up shoulder that re-facing on site won't remove.", "Rework"],
  ["TD", "Thread flanks or crests damaged beyond what a file can dress out.", "Rework"],
  ["PT", "Pitting in the thread roots or flanks.", "Rework"],
  ["PS", "Pitting across the sealing face of the shoulder.", "Rework"],
  ["NFS", "Shoulder face not flat against a straight edge; re-face on site.", "Field repair"],
  ["ST", "Pin threads stretched, shown by the lead gauge.", "Rework"],
  ["GT", "Galling on the thread flanks.", "Rework"],
  ["OT", "Signs of over-torque on the pin or box.", "Rework"],
  ["GS", "Galling on the shoulder face that dressing on site removes.", "Field repair"],
  ["RFD", "Shoulder re-faced on site during this inspection.", "Field repair"],
  ["IE", "Erosion inside the tube or the tool joint bore.", "Class 2"],
  ["IC", "Corrosion pitting inside the tube.", "Class 2"],
  ["BB", "Box swelled at the counterbore.", "Rework"],
  ["CRK", "Any crack found by MPI or UT.", "Scrap"],
  ["BENT", "Tube fails the straightness check.", "Bent"],
] as const).map(([code, criterion, outcome]) => ({ code, criterion, outcome, sample: true }));
const outcomeOf = (criteria: DamageCriterion[], code: string): DamageOutcome => criteria.find((item) => item.code === code)?.outcome ?? "Rework";

export const FINAL_CLASSES: FinalClass[] = ["Class 1 (New)", "Class 1-Rework", "Premium-Accepted", "Premium-Rework", "Class-2", "Bent", "Scrap"];

// API RP 7G-2 tube classes by remaining wall: Premium keeps 80% of nominal, Class 2 keeps 70%.
const PREMIUM_WALL = 0.8;
const CLASS2_WALL = 0.7;

export const thou = (value: number) => Math.round(value * 1000) / 1000;
export const inches = (value: number) => value.toFixed(3);
export const readingText = (column: TallyColumn, value: number) => column.key === "length" ? value.toFixed(2) : inches(value);

// A reading past its Premium limit. "class2" is the Class 2 limit on the same side, when the table has one, and "outcome"
// is what the reading alone does to the pipe.
export type Failure = { column: TallyColumn; value: number; limit: number; side: "min" | "max"; class2?: number; outcome: "Class 2" | "Scrap" | "Rework" };

export function limitFor(column: TallyColumn, spec: ConnectionSpec, job: Pick<TallyJob, "nominalWall">): Limit | undefined {
  if (column.key === "remWall") return { column: "Remaining wall", min: thou(job.nominalWall * PREMIUM_WALL), class2Min: thou(job.nominalWall * CLASS2_WALL) };
  return column.limit?.map((name) => spec.limits.find((limit) => limit.column === name)).find(Boolean);
}

// Gauges read to a thousandth of an inch, so compare at three decimals; a value on the limit passes. Past the Premium limit
// but inside the Class 2 one makes the pipe Class 2, and past that scraps it. A limit without a Class 2 tier is a connection
// dimension, so failing it means rework; the exception is a box OD, which DS-1 tables give for Premium only and which
// downgrades the pipe to Class 2 as before.
export function limitFailure(column: TallyColumn, limit: Limit | undefined, value: number | undefined): Failure | undefined {
  if (!limit || value === undefined) return undefined;
  const reading = thou(value);
  const side = limit.min !== undefined && reading < thou(limit.min) ? "min" : limit.max !== undefined && reading > thou(limit.max) ? "max" : undefined;
  if (!side) return undefined;
  const class2 = side === "min" ? limit.class2Min : limit.class2Max;
  const outcome = class2 === undefined ? column.key === "boxOd" ? "Class 2" : "Rework"
    : (side === "min" ? reading >= thou(class2) : reading <= thou(class2)) ? "Class 2" : "Scrap";
  return { column, value, limit: side === "min" ? limit.min! : limit.max!, side, class2, outcome };
}

export type Side = "box" | "pin" | "both" | "other";
export type Defect = { column: TallyColumn; code: string; outcome: DamageOutcome };
export type Graded = { suggested: FinalClass | "Pending"; final: FinalClass | "Pending"; failures: Failure[]; defects: Defect[]; rework?: Side; repaired?: Side };

// KTrack suggests a final class and the inspector confirms or changes it. The suggestion only uses the dimension table and
// the damage criteria: the worst outcome of any reading or condition code wins, Scrap over Class 2 over Bent over rework.
// Remaining wall is Premium down to 80% of nominal and Class 2 down to 70%. A field repair keeps the pipe's class.
export function gradePipe(spec: ConnectionSpec, job: Pick<TallyJob, "nominalWall" | "criteria">, joint: Joint): Graded {
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
  const criteria = job.criteria ?? SAMPLE_CRITERIA;
  const coded: Defect[] = TALLY_COLUMNS.filter((column) => column.kind === "code" && joint.codes[column.key] && joint.codes[column.key] !== "OK").map((column) => ({ column, code: joint.codes[column.key], outcome: outcomeOf(criteria, joint.codes[column.key]) }));
  const defects = coded.filter((defect) => defect.outcome !== "Field repair");
  const issue = (group: Group) => failures.some((failure) => failure.column.group === group) || defects.some((defect) => defect.column.group === group);
  const box = issue("Box tool joint");
  const pin = issue("Pin tool joint");
  const repairedBox = coded.some((item) => item.outcome === "Field repair" && item.column.group === "Box tool joint");
  const repairedPin = coded.some((item) => item.outcome === "Field repair" && item.column.group === "Pin tool joint");
  const outcomes: DamageOutcome[] = [...failures.map((failure) => failure.outcome), ...defects.map((defect) => defect.outcome)];
  const suggested: FinalClass | "Pending" = outcomes.includes("Scrap") ? "Scrap"
    : outcomes.includes("Class 2") ? "Class-2"
    : outcomes.includes("Bent") ? "Bent"
    : outcomes.length ? "Premium-Rework"
    : missing ? "Pending" : "Premium-Accepted";
  return {
    suggested,
    final: joint.finalClass ?? suggested,
    failures,
    defects,
    rework: box && pin ? "both" : box ? "box" : pin ? "pin" : issue("Pipe body") ? "other" : undefined,
    repaired: repairedBox && repairedPin ? "both" : repairedBox ? "box" : repairedPin ? "pin" : undefined,
  };
}

// "Box tong space 8.190, min 8.250", "Box OD 6.150, Premium min 6.190" (Class 2), "Box OD 6.050, Class 2 min 6.090" (Scrap)
// or "Box condition TD (thread damaged)"
export const failureText = ({ column, value, limit, side, class2, outcome }: Failure) => `${column.name} ${readingText(column, value)}, ${class2 === undefined ? side : outcome === "Scrap" ? `Class 2 ${side}` : `Premium ${side}`} ${inches(outcome === "Scrap" && class2 !== undefined ? class2 : limit)}`;
export const defectText = ({ column, code }: { column: TallyColumn; code: string }) => `${column.name} ${code}${CODES[code] ? ` (${CODES[code].toLowerCase()})` : ""}`;
export const reasons = (graded: Graded) => [...graded.failures.map(failureText), ...graded.defects.map(defectText)];

const rangeText = (min?: number, max?: number) => min !== undefined && max !== undefined ? `${inches(min)} to ${inches(max)}` : min !== undefined ? `min ${inches(min)}` : max !== undefined ? `max ${inches(max)}` : "";
export const limitText = (limit: Limit) => rangeText(limit.min, limit.max);
// Printed under the Premium limit, so a lone min or max on the same side as Premium drops the word: "min 6.190" over "6.090".
export const class2Text = (limit: Limit) => {
  const text = rangeText(limit.class2Min, limit.class2Max);
  return /^(min|max) /.test(text) && text.slice(0, 4) === limitText(limit).slice(0, 4) ? text.slice(4) : text;
};

export const connectionLabel = (spec: Pick<ConnectionSpec, "size" | "weight" | "connection" | "grade">) => `${spec.size}" ${spec.weight} ${spec.connection} grade ${spec.grade}`;

// The new tally form picks a row one F.582 header field at a time. A field keeps the wanted value while a row has it, else
// takes the first that does, so changing the size keeps the grade if the new size comes in that grade.
export const CONNECTION_STEPS = ["size", "weight", "connection", "grade"] as const;
export function pickConnection(specs: ConnectionSpec[], want: Partial<Pick<ConnectionSpec, (typeof CONNECTION_STEPS)[number]>>) {
  let rows = specs;
  const steps = CONNECTION_STEPS.map((field) => {
    const options = [...new Set(rows.map((spec) => spec[field]))];
    if (field === "size" || field === "weight") options.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    const value = options.includes(want[field] ?? "") ? want[field]! : options[0];
    rows = rows.filter((spec) => spec[field] === value);
    return { field, options, value };
  });
  return { steps, spec: rows[0] as ConnectionSpec | undefined };
}

// The F.581 results table: one row per class, each split by where rework is needed and what was repaired in the field.
export type ResultRow = { label: string; count: number; rework: Record<Side, number>; repaired: Record<"box" | "pin" | "other", number> };
export type TallySummary = { total: number; pending: number; accepted: number; rows: ResultRow[]; downgraded: { joint: Joint; graded: Graded }[] };

export function summarizeTally(spec: ConnectionSpec, job: Pick<TallyJob, "nominalWall" | "criteria">, joints: Joint[]): TallySummary {
  const graded = joints.map((joint) => ({ joint, graded: gradePipe(spec, job, joint) }));
  const row = (label: string, items: typeof graded): ResultRow => ({
    label, count: items.length,
    rework: { box: items.filter(({ graded: g }) => g.rework === "box").length, pin: items.filter(({ graded: g }) => g.rework === "pin").length, both: items.filter(({ graded: g }) => g.rework === "both").length, other: items.filter(({ graded: g }) => g.rework === "other").length },
    repaired: { box: items.filter(({ graded: g }) => g.repaired === "box" || g.repaired === "both").length, pin: items.filter(({ graded: g }) => g.repaired === "pin" || g.repaired === "both").length, other: 0 },
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
    && (spec.standard === undefined || isText(spec.standard))
    && Array.isArray(spec.limits) && spec.limits.every((limit) => Boolean(limit && typeof limit === "object" && isText(limit.column) && [limit.min, limit.max, limit.class2Min, limit.class2Max].every(isOptionalNumber)));
}

export function isCriterion(value: unknown): value is DamageCriterion {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DamageCriterion>;
  return isText(item.code) && isText(item.criterion) && DAMAGE_OUTCOMES.includes(item.outcome as DamageOutcome) && (item.sample === undefined || typeof item.sample === "boolean");
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
  return [item.id, item.kind, item.model, item.serial].every(isText) && isDate(item.calibrationDue) && (item.calibratedOn === undefined || isDate(item.calibratedOn));
}

export function isTallyJob(value: unknown): value is TallyJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<TallyJob>;
  return [job.well, job.location, job.range, job.standard, job.serviceCategory].every(isText) && isNumber(job.nominalWall) && job.nominalWall > 0
    && [job.toolJointOd, job.pinId, job.hardBand].every((item) => item === undefined || isText(item))
    && isTextList(job.program) && isTextList(job.services) && isTextList(job.equipmentIds)
    && (job.equipment === undefined || (Array.isArray(job.equipment) && job.equipment.every(isEquipment)))
    && (job.criteria === undefined || (Array.isArray(job.criteria) && job.criteria.every(isCriterion)));
}
