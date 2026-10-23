import * as XLSX from "xlsx";
import { addDays, addMonthsClamped, approveInspection, createInitialState, makeId, nowIso, recalculateAlerts, rowToRecord, submitInspection, todayString, trimValue } from "./domain";
import { connectionLabel, limitFor, TALLY_COLUMNS, type TallyColumn } from "./tally";
import type { Activity, AppState, ConnectionSpec, Equipment, ImportError, Inspection, Joint, Limit, Role, TallyJob } from "./types";

// The client's dimension table is DS-1 content, licensed, and this repo is public: these rows are made up, and the real
// table is imported from contextforclient/ during the call. Same columns as the client's Table 3.7.3, in inches.
const SAMPLE_LIMITS = (boxOd: number): Limit[] => [
  { column: "Box OD", min: boxOd },
  { column: "C'bore wall", min: 0.313 },
  { column: "Tong space pin", min: 6 },
  { column: "Tong space box", min: 8.25 },
  { column: "Bevel diameter", min: 6.41, max: 6.56 },
  { column: "Pin connection length", min: 4.49, max: 4.5 },
  { column: "Pin nose diameter", min: 4.74, max: 4.79 },
  { column: "Box c'bore diameter", min: 5.4, max: 5.47 },
  { column: "Box connection length", min: 4.505, max: 4.515 },
];

export const SAMPLE_CONNECTIONS: ConnectionSpec[] = [
  { id: "sample-50-g", size: "5", weight: "19.50", connection: "Sample 50", grade: "G", limits: SAMPLE_LIMITS(6.06), sample: true },
  { id: "sample-50-s", size: "5", weight: "19.50", connection: "Sample 50", grade: "S", limits: SAMPLE_LIMITS(6.19), sample: true },
  { id: "sample-50-v", size: "5", weight: "19.50", connection: "Sample 50", grade: "V-150", limits: SAMPLE_LIMITS(6.25), sample: true },
];

// The template's fixed columns; every other header is a limit named "<dimension> min" or "<dimension> max".
const KEY_HEADERS = ["Size", "Weight", "Connection", "Grade"] as const;
const normal = (value: unknown) => trimValue(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const specKey = (spec: Pick<ConnectionSpec, "size" | "weight" | "connection" | "grade">) => [spec.size, spec.weight, spec.connection, spec.grade].map(normal).join("|");

export function templateMatrix(specs: ConnectionSpec[] = SAMPLE_CONNECTIONS): (string | number)[][] {
  const columns = [...new Set(specs.flatMap((spec) => spec.limits.map((limit) => limit.column)))];
  const ends = columns.flatMap((column) => [`${column} min`, `${column} max`]);
  return [[...KEY_HEADERS, ...ends], ...specs.map((spec) => [spec.size, spec.weight, spec.connection, spec.grade, ...columns.flatMap((column) => {
    const limit = spec.limits.find((item) => item.column === column);
    return [limit?.min ?? "", limit?.max ?? ""];
  })])];
}

export function downloadTemplate() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(templateMatrix()), "Connections");
  XLSX.writeFile(book, "ktrack-dimension-table-template.xlsx");
}

export type ConnectionsPreview = { specs: ConnectionSpec[]; errors: ImportError[] };

// Reads the first sheet with a Size, Weight, Connection and Grade header row. Like the printed table, a blank size,
// weight or connection repeats the row above, so each grade can sit on its own line under one connection.
export function parseConnectionsWorkbook(buffer: ArrayBuffer): ConnectionsPreview {
  const workbook = XLSX.read(buffer, { type: "array" });
  for (const name of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "", raw: true });
    const headerIndex = matrix.findIndex((row) => KEY_HEADERS.every((header) => row.some((cell) => normal(cell) === normal(header))));
    if (headerIndex !== -1) return readConnections(matrix[headerIndex].map(trimValue), matrix.slice(headerIndex + 1), headerIndex + 2);
  }
  throw new Error(`Use the dimension table template: one header row with ${KEY_HEADERS.join(", ")}, then "<dimension> min" and "<dimension> max" columns.`);
}

function readConnections(headers: string[], rows: unknown[][], firstRow: number): ConnectionsPreview {
  const at = (header: string) => headers.findIndex((cell) => normal(cell) === normal(header));
  const keys = KEY_HEADERS.map(at);
  const ends = headers.flatMap((header, index) => {
    const match = /^(.+?)\s+(min|max)\.?$/i.exec(header);
    return match ? [{ index, column: match[1].trim(), side: match[2].toLowerCase() as "min" | "max" }] : [];
  });
  const columns = [...new Set(ends.map((end) => end.column))];
  const specs: ConnectionSpec[] = [];
  const errors: ImportError[] = [];
  let above = ["", "", ""];
  rows.forEach((values, index) => {
    if (values.every((value) => !trimValue(value))) return;
    const row = firstRow + index;
    const [size, weight, connection, grade] = keys.map((column, position) => trimValue(values[column]) || (position < 3 ? above[position] : ""));
    above = [size, weight, connection];
    const fail = (field: string, message: string) => { errors.push({ row, field, message }); };
    if (!size || !weight || !connection) return fail("Connection", "Size, weight and connection are required");
    if (!grade) return fail("Grade", "Grade is required");
    const limits: Limit[] = [];
    for (const column of columns) {
      const limit: Limit = { column };
      for (const end of ends.filter((item) => item.column === column)) {
        const cell = values[end.index];
        if (!trimValue(cell)) continue;
        const value = typeof cell === "number" ? cell : Number(trimValue(cell));
        if (!Number.isFinite(value) || value <= 0) return fail(`${column} ${end.side}`, `${column} ${end.side} must be a positive number of inches`);
        limit[end.side] = value;
      }
      if (limit.min !== undefined && limit.max !== undefined && limit.min > limit.max) return fail(column, `${column} min is above its max`);
      if (limit.min !== undefined || limit.max !== undefined) limits.push(limit);
    }
    if (!limits.length) return fail("Limits", "The row has no limits");
    specs.push({ id: makeId("conn"), size, weight, connection, grade, limits });
  });
  return { specs, errors };
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
  const job: TallyJob = { well: input.well.trim(), location: input.location.trim(), range: input.range, nominalWall: input.nominalWall, standard: STANDARD, serviceCategory: input.serviceCategory, program: INSPECTION_PROGRAM.filter((item) => item !== "UT slip & upset" && item !== "Heat check"), services: [], equipmentIds: (state.equipment ?? []).map((item) => item.id) };
  const joints: Joint[] = Array.from({ length: input.joints }, (_, index) => ({ no: index + 1, values: {}, codes: {} }));
  const inspection: Inspection = { id: makeId("inspection"), assetId: record.id, inspector, title: TALLY_TITLE, checklist: [], connection: spec, job, joints, notes: "", status: "Draft", createdAt: timestamp, updatedAt: timestamp };
  return { state: { ...state, records: [...state.records, record], inspections: [inspection, ...state.inspections], activity: [activityEntry("Job opened", `${jobNo} · ${connectionLabel(spec)}`, actor, timestamp), ...state.activity] }, inspection };
}

// The F.581 equipment details, one of each. Made-up models and serials; the lead gauge falls due first, so moving the
// demo date a fortnight on shows a tally sheet blocked by an expired calibration.
export function sampleEquipment(demoDate: string): Equipment[] {
  return ([["EMI console", "EMI-500", 142], ["EMI coil", "EC-5", 142], ["Mag. coil", "MC-12", 88], ["UT gauge", "UTG-38", 61], ["AC yoke", "AY-230", 205], ["UT flaw detector", "UFD-650", 119], ["UV meter", "UVM-25", 34], ["Lead gauge", "LG-4", 12], ["Profile gauge", "PG-6", 176]] as const)
    .map(([kind, model, days], index) => ({ id: `eq-${index + 1}`, kind, model, serial: `AMS-${model.split("-")[0]}-${String(141 + index * 37).padStart(4, "0")}`, calibrationDue: addDays(demoDate, days) }));
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
  let state: AppState = { ...createInitialState(demoDate), connections: SAMPLE_CONNECTIONS, equipment: sampleEquipment(demoDate) };
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
