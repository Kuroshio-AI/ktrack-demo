import * as XLSX from "xlsx";
import { addDays, addMonthsClamped, approveInspection, createInitialState, deleteInspection, isDateString, makeId, nowIso, recalculateAlerts, rowToRecord, submitInspection, todayString, trimValue } from "./domain";
import { connectionLabel, DAMAGE_OUTCOMES, limitFor, SAMPLE_CRITERIA, TALLY_COLUMNS, type TallyColumn } from "./tally";
import { formatDate } from "./utils";
import type { Activity, AppState, ConnectionSpec, DamageOutcome, Equipment, ImportError, Inspection, Joint, Limit, Role, TallyJob } from "./types";

// The client's dimension table is DS-1 content, licensed, and this repo is public: these rows are made up, and the real
// table is imported from contextforclient/ during the call. Same columns as the client's Table 3.7.3, in inches, plus made-up
// Class 2 limits for box OD and counterbore wall like those in API RP 7G-2.
const SAMPLE_LIMITS = (boxOd: number, class2Od: number): Limit[] => [
  { column: "Box OD", min: boxOd, class2Min: class2Od },
  { column: "C'bore wall", min: 0.313, class2Min: 0.281 },
  { column: "Tong space pin", min: 6 },
  { column: "Tong space box", min: 8.25 },
  { column: "Bevel diameter", min: 6.41, max: 6.56 },
  { column: "Pin connection length", min: 4.49, max: 4.5 },
  { column: "Pin nose diameter", min: 4.74, max: 4.79 },
  { column: "Box c'bore diameter", min: 5.4, max: 5.47 },
  { column: "Box connection length", min: 4.505, max: 4.515 },
];

export const SAMPLE_CONNECTIONS: ConnectionSpec[] = [
  { id: "sample-50-g", size: "5", weight: "19.50", connection: "Sample 50", grade: "G", limits: SAMPLE_LIMITS(6.06, 5.98), sample: true },
  { id: "sample-50-s", size: "5", weight: "19.50", connection: "Sample 50", grade: "S", limits: SAMPLE_LIMITS(6.19, 6.09), sample: true },
  { id: "sample-50-v", size: "5", weight: "19.50", connection: "Sample 50", grade: "V-150", limits: SAMPLE_LIMITS(6.25, 6.16), sample: true },
];

// The template's fixed columns. Every other header is a limit: "<dimension> min" or "<dimension> max" for Premium, and
// "<dimension> class 2 min" or "<dimension> class 2 max" for Class 2. Optional "Standard" and "Unit" (in or mm) columns apply
// to their row and, like size, weight and connection, carry down to the blank cells below.
const KEY_HEADERS = ["Size", "Weight", "Connection", "Grade"] as const;
const normal = (value: unknown) => trimValue(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const specKey = (spec: Pick<ConnectionSpec, "size" | "weight" | "connection" | "grade">) => [spec.size, spec.weight, spec.connection, spec.grade].map(normal).join("|");
const hasHeader = (row: unknown[], header: string) => row.some((cell) => normal(cell) === normal(header));

type Bound = Exclude<keyof Limit, "column">;
type End = { index: number; column: string; bound: Bound };
const BOUND_LABEL: Record<Bound, string> = { min: "min", max: "max", class2Min: "class 2 min", class2Max: "class 2 max" };

function limitEnds(headers: string[]): End[] {
  return headers.flatMap((header, index) => {
    const match = /^(.+?)\s+(class\s*2\s+)?(min|max)\.?$/i.exec(header);
    if (!match) return [];
    const side = match[3].toLowerCase() as "min" | "max";
    return [{ index, column: match[1].trim(), bound: match[2] ? (side === "min" ? "class2Min" : "class2Max") : side }];
  });
}

// Millimetres become inches rounded to the safe side, a minimum up and a maximum down, so nothing passes in inches that
// fails in millimetres.
function toInches(value: number, unit: "in" | "mm", bound: Bound) {
  if (unit === "in") return value;
  const thousandths = (value / 25.4) * 1000;
  return (bound === "min" || bound === "class2Min" ? Math.ceil(thousandths - 1e-6) : Math.floor(thousandths + 1e-6)) / 1000;
}

function readUnit(value: unknown): "in" | "mm" | undefined {
  const unit = normal(value);
  return ["in", "inch", "inches"].includes(unit) ? "in" : ["mm", "millimetre", "millimetres", "millimeter", "millimeters"].includes(unit) ? "mm" : undefined;
}

// The limits on one row, or a message for the first bad cell.
function readLimits(values: unknown[], ends: End[], unit: "in" | "mm"): Limit[] | { field: string; message: string } {
  const limits: Limit[] = [];
  for (const column of [...new Set(ends.map((end) => end.column))]) {
    const limit: Limit = { column };
    for (const end of ends.filter((item) => item.column === column)) {
      const cell = values[end.index];
      if (!trimValue(cell)) continue;
      const value = typeof cell === "number" ? cell : Number(trimValue(cell));
      if (!Number.isFinite(value) || value <= 0) return { field: `${column} ${BOUND_LABEL[end.bound]}`, message: `${column} ${BOUND_LABEL[end.bound]} must be a positive number` };
      limit[end.bound] = toInches(value, unit, end.bound);
    }
    const { min, max, class2Min, class2Max } = limit;
    if (min !== undefined && max !== undefined && min > max) return { field: column, message: `${column} min is above its max` };
    if ((class2Min !== undefined && min === undefined) || (class2Max !== undefined && max === undefined)) return { field: column, message: `${column} has a Class 2 limit but no Premium limit on that side` };
    if ((class2Min !== undefined && class2Min > min!) || (class2Max !== undefined && class2Max < max!)) return { field: column, message: `${column} Class 2 limit is tighter than its Premium limit` };
    if ([min, max, class2Min, class2Max].some((value) => value !== undefined)) limits.push(limit);
  }
  return limits;
}

export function templateMatrix(specs: ConnectionSpec[] = SAMPLE_CONNECTIONS): (string | number)[][] {
  const columns = [...new Set(specs.flatMap((spec) => spec.limits.map((limit) => limit.column)))];
  const bounds = (column: string): Bound[] => specs.some((spec) => spec.limits.some((limit) => limit.column === column && (limit.class2Min !== undefined || limit.class2Max !== undefined))) ? ["min", "max", "class2Min", "class2Max"] : ["min", "max"];
  return [[...KEY_HEADERS, "Standard", "Unit", ...columns.flatMap((column) => bounds(column).map((bound) => `${column} ${BOUND_LABEL[bound]}`))], ...specs.map((spec) => [spec.size, spec.weight, spec.connection, spec.grade, spec.standard ?? "", "in", ...columns.flatMap((column) => {
    const limit = spec.limits.find((item) => item.column === column);
    return bounds(column).map((bound) => limit?.[bound] ?? "");
  })])];
}

// Limits that depend on the connection alone, like API RP 7G-2 Table C.7, go on a second sheet: one row per connection.
const CONNECTION_TEMPLATE = ["Connection", "Unit", "Counterbore diameter max", "Counterbore length min", "Pin length min", "Pin length max", "Pin base length max", "Box thread length min"];

export function downloadTemplate() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(templateMatrix()), "Connections");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([CONNECTION_TEMPLATE]), "Connection dimensions");
  XLSX.writeFile(book, "ktrack-dimension-table-template.xlsx");
}

export type ConnectionsPreview = { specs: ConnectionSpec[]; errors: ImportError[]; shared: number };

// Reads the first sheet with a Size, Weight, Connection and Grade header row. Like the printed table, a blank size, weight or
// connection repeats the row above, so each grade can sit on its own line under one connection. Any other sheet with a
// Connection column but no Size holds limits for the connection alone; they're added to every row with that connection.
export function parseConnectionsWorkbook(buffer: ArrayBuffer): ConnectionsPreview {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheets = workbook.SheetNames.map((name) => ({ name, matrix: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "", raw: true }) }));
  const main = sheets.map((sheet) => ({ ...sheet, at: sheet.matrix.findIndex((row) => KEY_HEADERS.every((header) => hasHeader(row, header))) })).find((sheet) => sheet.at !== -1);
  if (!main) throw new Error(`Use the dimension table template: one header row with ${KEY_HEADERS.join(", ")}, then "<dimension> min" and "<dimension> max" columns.`);
  const preview = readConnections(main.matrix[main.at].map(trimValue), main.matrix.slice(main.at + 1), main.at + 2);
  let shared = 0;
  for (const sheet of sheets.filter((item) => item !== main)) {
    const at = sheet.matrix.findIndex((row) => hasHeader(row, "Connection") && !hasHeader(row, "Size") && limitEnds(row.map(trimValue)).length > 0);
    if (at === -1) continue;
    const { byConnection, errors } = readConnectionLimits(sheet.name, sheet.matrix[at].map(trimValue), sheet.matrix.slice(at + 1), at + 2);
    preview.errors.push(...errors);
    shared += byConnection.size;
    for (const spec of preview.specs) {
      const extra = byConnection.get(normal(spec.connection)) ?? [];
      spec.limits.push(...extra.filter((limit) => !spec.limits.some((own) => own.column === limit.column)));
    }
  }
  return { ...preview, shared };
}

function readConnections(headers: string[], rows: unknown[][], firstRow: number): Omit<ConnectionsPreview, "shared"> {
  const at = (header: string) => headers.findIndex((cell) => normal(cell) === normal(header));
  const keys = KEY_HEADERS.map(at);
  const standardAt = at("Standard");
  const unitAt = at("Unit");
  const ends = limitEnds(headers);
  const specs: ConnectionSpec[] = [];
  const errors: ImportError[] = [];
  let above = { size: "", weight: "", connection: "", standard: "", unit: "" };
  rows.forEach((values, index) => {
    if (values.every((value) => !trimValue(value))) return;
    const row = firstRow + index;
    const [size, weight, connection, grade] = keys.map((column, position) => trimValue(values[column]) || (position < 3 ? Object.values(above)[position] : ""));
    const standard = (standardAt !== -1 && trimValue(values[standardAt])) || above.standard;
    const unitText = (unitAt !== -1 && trimValue(values[unitAt])) || above.unit;
    above = { size, weight, connection, standard, unit: unitText };
    const fail = (field: string, message: string) => { errors.push({ row, field, message }); };
    if (!size || !weight || !connection) return fail("Connection", "Size, weight and connection are required");
    if (!grade) return fail("Grade", "Grade is required");
    const unit = unitText ? readUnit(unitText) : "in";
    if (!unit) return fail("Unit", `Unit must be "in" or "mm", not "${unitText}"`);
    const limits = readLimits(values, ends, unit);
    if (!Array.isArray(limits)) return fail(limits.field, limits.message);
    if (!limits.length) return fail("Limits", "The row has no limits");
    specs.push({ id: makeId("conn"), size, weight, connection, grade, ...(standard && { standard }), limits });
  });
  return { specs, errors };
}

function readConnectionLimits(sheet: string, headers: string[], rows: unknown[][], firstRow: number) {
  const connectionAt = headers.findIndex((cell) => normal(cell) === "connection");
  const unitAt = headers.findIndex((cell) => normal(cell) === "unit");
  const ends = limitEnds(headers);
  const byConnection = new Map<string, Limit[]>();
  const errors: ImportError[] = [];
  let unitAbove = "";
  rows.forEach((values, index) => {
    if (values.every((value) => !trimValue(value))) return;
    const row = firstRow + index;
    const fail = (field: string, message: string) => { errors.push({ row, field: `${sheet}: ${field}`, message: `${sheet}: ${message}` }); };
    const connection = trimValue(values[connectionAt]);
    const unitText = (unitAt !== -1 && trimValue(values[unitAt])) || unitAbove;
    unitAbove = unitText;
    if (!connection) return fail("Connection", "Connection is required");
    const unit = unitText ? readUnit(unitText) : "in";
    if (!unit) return fail("Unit", `Unit must be "in" or "mm", not "${unitText}"`);
    const limits = readLimits(values, ends, unit);
    if (!Array.isArray(limits)) return fail(limits.field, limits.message);
    byConnection.set(normal(connection), limits);
  });
  return { byConnection, errors };
}

const activityEntry = (event: string, detail: string, actor: Role, timestamp: string): Activity => ({ id: makeId("activity"), event, detail, actor, timestamp });

// An imported row replaces the one already here with the same size, weight, connection and grade; the rest are added.
export function importConnections(state: AppState, specs: ConnectionSpec[], actor = state.role, timestamp = nowIso()): AppState {
  if (!specs.length) return state;
  const incoming = new Map(specs.map((spec) => [specKey(spec), spec]));
  const kept = (state.connections ?? []).map((spec) => incoming.get(specKey(spec)) ?? spec);
  const added = specs.filter((spec) => !kept.includes(spec));
  return { ...state, connections: [...kept, ...added], activity: [activityEntry("Dimension table imported", `${specs.length} connection${specs.length === 1 ? "" : "s"}`, actor, timestamp), ...state.activity] };
}

export type TallyInput = { jobNo: string; customer: string; rig: string; well: string; location: string; connectionId: string; joints: number; inspector: string; range: string; nominalWall: number; serviceCategory: string };

export const TALLY_TITLE = "Drill pipe inspection";
export const INSPECTION_PROGRAM = ["Visual tube", "OD gauge", "UT gauging", "EMI", "MPI slip & upset", "UT slip & upset", "Visual connection", "Dimension-2", "MPI connection", "Heat check"];
export const ADDITIONAL_SERVICES = ["Straightening", "Ext. blast", "Int. blast", "Refacing", "Coating", "Other"];
export const STANDARD = "DS-1 5th edition, Vol. 3";

// Opening a job creates its record and its tally sheet, one empty line per pipe with every condition code OK,
// listing every instrument in the equipment register.
export function createTally(state: AppState, input: TallyInput, actor = state.role, timestamp = nowIso()): { state: AppState; inspection: Inspection } {
  const jobNo = input.jobNo.trim();
  const spec = state.connections?.find((item) => item.id === input.connectionId);
  if (!jobNo || !input.customer.trim() || !input.rig.trim()) throw new Error("Work order, customer and rig are required.");
  if (state.records.some((record) => record.assetRef.trim().toLowerCase() === jobNo.toLowerCase())) throw new Error(`${jobNo} already exists. Use a new work order number.`);
  if (!spec) throw new Error("Choose a connection from the dimension table.");
  if (!Number.isSafeInteger(input.joints) || input.joints < 1 || input.joints > 500) throw new Error("A tally sheet holds 1 to 500 pipes.");
  if (!Number.isFinite(input.nominalWall) || input.nominalWall <= 0 || input.nominalWall >= 2) throw new Error("Nominal wall must be a thickness in inches, such as 0.362.");
  const inspector = input.inspector.trim() || actor;
  const record = { ...rowToRecord({ assetRef: jobNo, recordType: "equipment", assetType: connectionLabel(spec), site: input.rig.trim(), owner: input.customer.trim(), assignedEngineer: inspector, status: "Active" }, actor, timestamp), activity: [activityEntry("Job opened", `${input.joints} pipes`, actor, timestamp)] };
  const job: TallyJob = { well: input.well.trim(), location: input.location.trim(), range: input.range, nominalWall: input.nominalWall, standard: spec.standard ?? STANDARD, serviceCategory: input.serviceCategory, program: INSPECTION_PROGRAM.filter((item) => item !== "UT slip & upset" && item !== "Heat check"), services: [], equipmentIds: (state.equipment ?? []).map((item) => item.id), criteria: state.criteria ?? SAMPLE_CRITERIA };
  const joints: Joint[] = Array.from({ length: input.joints }, (_, index) => ({ no: index + 1, values: {}, codes: {} }));
  const inspection: Inspection = { id: makeId("inspection"), assetId: record.id, inspector, title: TALLY_TITLE, checklist: [], connection: spec, job, joints, notes: "", status: "Draft", createdAt: timestamp, updatedAt: timestamp };
  return { state: { ...state, records: [...state.records, record], inspections: [inspection, ...state.inspections], activity: [activityEntry("Job opened", `${jobNo} · ${connectionLabel(spec)}`, actor, timestamp), ...state.activity] }, inspection };
}

// A sheet's pipes follow the rack: one is added at the end, and only an empty last pipe comes off, so numbers never shift
// under readings already taken.
export const isEmptyPipe = (joint: Joint) => !joint.serial && !joint.coating && !joint.finalClass && !Object.keys(joint.values).length && !Object.values(joint.codes).some(Boolean);
export const addPipe = (joints: Joint[]): Joint[] => [...joints, { no: (joints.at(-1)?.no ?? 0) + 1, values: {}, codes: {} }];
export function removeLastPipe(joints: Joint[]): Joint[] {
  const last = joints.at(-1);
  if (!last || joints.length === 1 || !isEmptyPipe(last)) throw new Error("Only an empty last pipe can be removed, and a sheet keeps at least one.");
  return joints.slice(0, -1);
}

// Deletes a draft tally sheet and, when nothing else uses it, the job it opened, so its work order number is free again.
// A job with a report or another sheet stays.
export function deleteTally(state: AppState, id: string, actor = state.role, timestamp = nowIso()): AppState {
  const sheet = state.inspections.find((item) => item.id === id);
  if (!sheet || sheet.status !== "Draft") return state;
  const job = state.records.find((record) => record.id === sheet.assetId);
  const keep = !job || job.certificates.length > 0 || state.inspections.some((other) => other.id !== id && other.assetId === job.id);
  const next = deleteInspection(state, id);
  return {
    ...next,
    records: keep ? next.records : next.records.filter((record) => record.id !== job.id),
    activity: [activityEntry("Tally sheet deleted", `${job?.assetRef ?? "Draft"}, ${sheet.joints?.length ?? 0} pipes`, actor, timestamp), ...next.activity],
  };
}

// Adds an instrument to the register. Serials are unique because the report identifies each instrument by its serial.
export function addEquipment(state: AppState, input: Omit<Equipment, "id">): { state: AppState; item: Equipment } {
  const item: Equipment = { id: makeId("equipment"), kind: input.kind.trim(), model: input.model.trim(), serial: input.serial.trim(), calibrationDue: input.calibrationDue };
  if (!item.kind || !item.model || !item.serial) throw new Error("Enter the instrument, its model and its serial number.");
  if (!isDateString(item.calibrationDue)) throw new Error("Enter the calibration due date.");
  if ((state.equipment ?? []).some((other) => other.serial.toLowerCase() === item.serial.toLowerCase())) throw new Error(`An instrument with serial ${item.serial} is already listed.`);
  return { state: { ...state, equipment: [...(state.equipment ?? []), item] }, item };
}

// Records a calibration: the day it was done and the next due date from its certificate. The new due date clears the
// instrument's calibration alert and unblocks tally sheets that used it.
export function recordCalibration(state: AppState, id: string, calibratedOn: string, calibrationDue: string, actor = state.role, timestamp = nowIso()): AppState {
  const item = (state.equipment ?? []).find((other) => other.id === id);
  if (!item) throw new Error("That instrument is no longer listed.");
  if (!isDateString(calibratedOn)) throw new Error("Enter the date it was calibrated.");
  if (calibratedOn > state.demoDate) throw new Error("The calibration date can't be in the future.");
  if (!isDateString(calibrationDue) || calibrationDue <= calibratedOn) throw new Error("Enter a next due date after the calibration date.");
  return {
    ...state,
    equipment: state.equipment!.map((other) => other.id === id ? { ...other, calibratedOn, calibrationDue } : other),
    activity: [activityEntry("Instrument calibrated", `${item.kind} ${item.serial}, next due ${formatDate(calibrationDue)}`, actor, timestamp), ...state.activity],
  };
}

// Changing a damage criterion regrades the tally sheets still being filled in; submitted and issued sheets keep the criteria
// they were graded with. Rewording a sample criterion makes it the client's own.
export function updateCriterion(state: AppState, code: string, patch: { criterion?: string; outcome?: DamageOutcome }, actor = state.role, timestamp = nowIso()): AppState {
  const current = state.criteria ?? SAMPLE_CRITERIA;
  const before = current.find((item) => item.code === code);
  if (!before) throw new Error(`${code} is not a condition code on the tally sheet.`);
  const criterion = patch.criterion === undefined ? before.criterion : patch.criterion.trim();
  const outcome = patch.outcome ?? before.outcome;
  if (!criterion) throw new Error("Describe the damage this code records.");
  if (!DAMAGE_OUTCOMES.includes(outcome)) throw new Error("Choose what the damage does to the pipe.");
  if (criterion === before.criterion && outcome === before.outcome) return state;
  const { sample: _, ...own } = before;
  const next = criterion === before.criterion ? { ...before, outcome } : { ...own, criterion, outcome };
  const criteria = current.map((item) => item.code === code ? next : item);
  const open = (inspection: Inspection) => Boolean(inspection.job) && (inspection.status === "Draft" || inspection.status === "Returned");
  return {
    ...state,
    criteria,
    inspections: state.inspections.map((inspection) => open(inspection) ? { ...inspection, job: { ...inspection.job!, criteria } } : inspection),
    activity: [activityEntry("Damage criterion changed", `${code} now means ${outcome.toLowerCase()}`, actor, timestamp), ...state.activity],
  };
}

// The F.581 equipment details, one of each, each calibrated a year before it falls due. Made-up models and serials; the
// lead gauge falls due first, so moving the demo date a fortnight on shows a tally sheet blocked by an expired calibration.
export function sampleEquipment(demoDate: string): Equipment[] {
  return ([["EMI console", "EMI-500", 142], ["EMI coil", "EC-5", 142], ["Mag. coil", "MC-12", 88], ["UT gauge", "UTG-38", 61], ["AC yoke", "AY-230", 205], ["UT flaw detector", "UFD-650", 119], ["UV meter", "UVM-25", 34], ["Lead gauge", "LG-4", 12], ["Profile gauge", "PG-6", 176]] as const)
    .map(([kind, model, days], index) => ({ id: `eq-${index + 1}`, kind, model, serial: `AMS-${model.split("-")[0]}-${String(141 + index * 37).padStart(4, "0")}`, calibrationDue: addDays(demoDate, days), calibratedOn: addMonthsClamped(addDays(demoDate, days), -12) }));
}

// Repeatable readings for the sample jobs, spread by pipe and column: inside any limit, plausible otherwise.
const PLAIN: Record<string, [number, number]> = { length: [30.4, 31.6], cboreDepth: [0.62, 0.64], pinId: [3.74, 3.76], pinCyl: [5.32, 5.36], lead: [0, 0.002], neck: [1.1, 1.2] };
function reading(column: TallyColumn, spec: ConnectionSpec, nominalWall: number, no: number, index: number): number {
  const spread = 0.15 + (((no * 37 + index * 17) % 89) / 89) * 0.7;
  const limit = limitFor(column, spec, { nominalWall });
  const [low, high] = column.key === "remWall" ? [nominalWall * 0.86, nominalWall * 0.97]
    : limit?.min !== undefined && limit.max !== undefined ? [limit.min, limit.max]
    : limit?.min !== undefined ? [limit.min + 0.02, limit.min + 0.3] : PLAIN[column.key] ?? [1, 2];
  return Math.round((low + (high - low) * spread) * (column.key === "length" ? 100 : 1000)) / (column.key === "length" ? 100 : 1000);
}

// A pipe's planted finding: a reading past a limit, a set value, a condition code, a coating grade, or readings left blank.
type Finding = ["past", key: string, side: "min" | "max", by: number] | ["value", key: string, value: number] | ["code", key: string, code: string] | ["coating", grade: number] | ["blank", keys: string[]];

function samplePipes(spec: ConnectionSpec, nominalWall: number, count: number, findings: Record<number, Finding[]>, prefix: string): Joint[] {
  return Array.from({ length: count }, (_, index) => {
    const no = index + 1;
    const joint: Joint = { no, serial: `${prefix}-${String(no).padStart(3, "0")}`, values: {}, codes: {}, coating: 1 + ((no * 7) % 2) };
    TALLY_COLUMNS.forEach((column, position) => { if (column.kind === "number") joint.values[column.key] = reading(column, spec, nominalWall, no, position); });
    for (const finding of findings[no] ?? []) {
      if (finding[0] === "past") { const column = TALLY_COLUMNS.find((item) => item.key === finding[1])!; const limit = limitFor(column, spec, { nominalWall })!; joint.values[finding[1]] = Math.round((finding[2] === "min" ? limit.min! - finding[3] : limit.max! + finding[3]) * 1000) / 1000; }
      if (finding[0] === "value") joint.values[finding[1]] = finding[2];
      if (finding[0] === "code") joint.codes[finding[1]] = finding[2];
      if (finding[0] === "coating") joint.coating = finding[1];
      if (finding[0] === "blank") for (const key of finding[1]) delete joint.values[key];
    }
    return joint;
  });
}

// 5" 19.50 lb/ft drill pipe has a 0.362 inch nominal wall.
const NOMINAL_WALL = 0.362;

// The shared demo link opens on this: the sample table and instruments, one issued report, and one tally sheet with three
// pipes still missing their box OD and tong space for the presenter to fill in.
export function amsInitialState(demoDate = todayString(), timestamp = nowIso()): AppState {
  let state: AppState = { ...createInitialState(demoDate), connections: SAMPLE_CONNECTIONS, equipment: sampleEquipment(demoDate), criteria: SAMPLE_CRITERIA };
  const base = { customer: "Sample Drilling Co.", location: "Musaffah yard", range: "R2", nominalWall: NOMINAL_WALL, serviceCategory: "Category 4" };
  const open = (input: Omit<TallyInput, keyof typeof base>, joints: Joint[]) => {
    const result = createTally(state, { ...base, ...input }, "Admin", timestamp);
    state = { ...result.state, inspections: result.state.inspections.map((item) => item.id === result.inspection.id ? { ...item, job: { ...item.job!, toolJointOd: "6.625", pinId: "3.750", hardBand: "Yes" }, joints } : item) };
    return result.inspection.id;
  };
  const issuedId = open({ jobNo: "WO-2026-0391", rig: "Rig SD-04", well: "SD-04-12", connectionId: "sample-50-g", joints: 24, inspector: "Rahul Menon" },
    samplePipes(SAMPLE_CONNECTIONS[0], NOMINAL_WALL, 24, { 9: [["past", "boxOd", "min", 0.041]], 17: [["code", "pinCond", "GT"]], 20: [["coating", 4]] }, "SD04"));
  state = approveInspection(submitInspection({ ...state, role: "Engineer" }, issuedId, timestamp), issuedId, addMonthsClamped(demoDate, 6), "Reviewer", timestamp);
  open({ jobNo: "WO-2026-0422", rig: "Rig SD-07", well: "SD-07-03", connectionId: "sample-50-s", joints: 40, inspector: "Omar Saeed" },
    samplePipes(SAMPLE_CONNECTIONS[1], NOMINAL_WALL, 40, {
      7: [["past", "boxTong", "min", 0.06]], 12: [["code", "boxCond", "TD"]], 15: [["code", "boxCond", "RFD"]], 19: [["past", "boxOd", "min", 0.035]],
      23: [["value", "remWall", 0.27]], 28: [["past", "pinBevel", "max", 0.02]], 31: [["code", "odCond", "BENT"]], 33: [["code", "boxMpi", "CRK"]], 35: [["coating", 3]],
      38: [["blank", ["boxOd", "boxTong"]]], 39: [["blank", ["boxOd", "boxTong"]]], 40: [["blank", ["boxOd", "boxTong"]]],
    }, "SD07"));
  return recalculateAlerts({ ...state, role: "Admin" }, timestamp);
}
