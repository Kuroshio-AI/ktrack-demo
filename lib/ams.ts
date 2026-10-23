import * as XLSX from "xlsx";
import { addMonthsClamped, approveInspection, createInitialState, makeId, nowIso, recalculateAlerts, rowToRecord, submitInspection, todayString, trimValue } from "./domain";
import { connectionLabel } from "./tally";
import type { Activity, AppState, ConnectionSpec, ImportError, Inspection, Joint, Limit, Role } from "./types";

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

export type TallyInput = { jobNo: string; customer: string; rig: string; connectionId: string; joints: number; inspector: string };

export const TALLY_TITLE = "Used tool joint dimensional inspection";

// Opening a job creates its register record and its tally sheet, with one empty line per joint.
export function createTally(state: AppState, input: TallyInput, actor = state.role, timestamp = nowIso()): { state: AppState; inspection: Inspection } {
  const jobNo = input.jobNo.trim();
  const spec = state.connections?.find((item) => item.id === input.connectionId);
  if (!jobNo || !input.customer.trim() || !input.rig.trim()) throw new Error("Job number, customer and rig are required.");
  if (state.records.some((record) => record.assetRef.trim().toLowerCase() === jobNo.toLowerCase())) throw new Error(`${jobNo} already exists. Use a new job number.`);
  if (!spec) throw new Error("Choose a connection from the dimension table.");
  if (!Number.isSafeInteger(input.joints) || input.joints < 1 || input.joints > 500) throw new Error("A tally sheet holds 1 to 500 joints.");
  const inspector = input.inspector.trim() || actor;
  const record = { ...rowToRecord({ assetRef: jobNo, recordType: "equipment", assetType: connectionLabel(spec), site: input.rig.trim(), owner: input.customer.trim(), assignedEngineer: inspector, status: "Active" }, actor, timestamp), activity: [activityEntry("Job opened", `${input.joints} joints`, actor, timestamp)] };
  const joints: Joint[] = Array.from({ length: input.joints }, (_, index) => ({ no: index + 1, values: {}, visual: "pending" }));
  const inspection: Inspection = { id: makeId("inspection"), assetId: record.id, inspector, title: TALLY_TITLE, checklist: [], connection: spec, joints, notes: "", status: "Draft", createdAt: timestamp, updatedAt: timestamp };
  return { state: { ...state, records: [...state.records, record], inspections: [inspection, ...state.inspections], activity: [activityEntry("Job opened", `${jobNo} · ${connectionLabel(spec)}`, actor, timestamp), ...state.activity] }, inspection };
}

// Repeatable readings for the sample jobs: inside the limits, spread by joint and column, and rounded to the thousandth.
function reading(limit: Limit, no: number, column: number): number {
  const spread = ((no * 37 + column * 17) % 89) / 89;
  const value = limit.min !== undefined && limit.max !== undefined ? limit.min + (limit.max - limit.min) * (0.15 + spread * 0.7) : (limit.min ?? (limit.max ?? 0) - 0.3) + 0.02 + spread * 0.25;
  return Math.round(value * 1000) / 1000;
}

// A joint's planted fault: a reading past one end of a limit, or a failed visual check.
type Defect = [column: string, side: "min" | "max", by: number] | "visual";

function sampleJoints(spec: ConnectionSpec, count: number, filled: number, defects: Record<number, Defect>, serialPrefix: string): Joint[] {
  return Array.from({ length: count }, (_, index) => {
    const no = index + 1;
    if (no > filled) return { no, serial: `${serialPrefix}-${String(no).padStart(3, "0")}`, values: {}, visual: "pending" };
    const defect = defects[no];
    const values = Object.fromEntries(spec.limits.map((limit, column) => {
      if (Array.isArray(defect) && defect[0] === limit.column) return [limit.column, Math.round((defect[1] === "min" ? limit.min! - defect[2] : limit.max! + defect[2]) * 1000) / 1000];
      return [limit.column, reading(limit, no, column)];
    }));
    return { no, serial: `${serialPrefix}-${String(no).padStart(3, "0")}`, values, visual: defect === "visual" ? "fail" : "pass" };
  });
}

// The shared demo link opens on this: the sample table, one issued report and one tally sheet left for the presenter to finish.
export function amsInitialState(demoDate = todayString(), timestamp = nowIso()): AppState {
  let state: AppState = { ...createInitialState(demoDate), connections: SAMPLE_CONNECTIONS };
  const open = (input: TallyInput, joints: Joint[]) => {
    const result = createTally(state, input, "Admin", timestamp);
    state = { ...result.state, inspections: result.state.inspections.map((item) => item.id === result.inspection.id ? { ...item, joints } : item) };
    return result.inspection.id;
  };
  const issuedId = open({ jobNo: "JOB-2026-0391", customer: "Sample Drilling Co.", rig: "Rig SD-04", connectionId: "sample-50-g", joints: 24, inspector: "Rahul Menon" }, sampleJoints(SAMPLE_CONNECTIONS[0], 24, 24, { 9: ["Box OD", "min", 0.041], 17: ["Pin nose diameter", "max", 0.012] }, "SD04"));
  state = approveInspection(submitInspection({ ...state, role: "Engineer" }, issuedId, timestamp), issuedId, addMonthsClamped(demoDate, 6), "Reviewer", timestamp);
  open({ jobNo: "JOB-2026-0422", customer: "Sample Drilling Co.", rig: "Rig SD-07", connectionId: "sample-50-s", joints: 40, inspector: "Omar Saeed" }, sampleJoints(SAMPLE_CONNECTIONS[1], 40, 36, { 7: ["Tong space box", "min", 0.06], 19: ["Box OD", "min", 0.035], 28: ["Bevel diameter", "max", 0.02], 33: "visual" }, "SD07"));
  return recalculateAlerts({ ...state, role: "Admin" }, timestamp);
}
