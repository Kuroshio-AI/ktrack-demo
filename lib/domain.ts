import type {
  Activity,
  Alert,
  AlertSeverity,
  AppState,
  AssetRecord,
  AssetStatus,
  Certificate,
  CertificateStatus,
  ChecklistItem,
  DeadlineTier,
  Inspection,
  InspectionStatus,
  ImportError,
  ImportPreview,
  RegisterHeader,
  RegisterRow,
  RecordType,
  Role,
  Saving,
  SavingHeader,
  SavingType,
  Warranty,
} from "./types";
import { REGISTER_HEADERS } from "./types";
import { FLS_DUE_LEAD_DAYS, IS_FLS } from "./client";
import { checklistFrom, type ChecklistTemplate } from "./fls-checklists";
import { expiredEquipment, isConnectionSpec, isEquipment, isJoint, isTallyJob, tallyComplete } from "./tally";

export const STORAGE_KEY = "keetrack-demo-state";
export const STORAGE_VERSION = 1 as const;

export const nowIso = (): string => new Date().toISOString();

export function makeId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid ?? Math.random().toString(36).slice(2, 12)}`;
}

export function isDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function todayString(date = new Date()): string {
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    .map((part, index) => index === 0 ? String(part).padStart(4, "0") : String(part).padStart(2, "0"))
    .join("-");
}

export function dateDiffDays(target: string, base: string): number {
  return Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${base}T00:00:00Z`)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const value = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return todayString(value);
}

export function addMonthsClamped(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + months, 1));
  const maxDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, maxDay));
  return todayString(next);
}

export function createInitialState(demoDate = todayString()): AppState {
  return { version: STORAGE_VERSION, demoDate, role: "Admin", records: [], inspections: [], alerts: [], activity: [] };
}

export function isRole(value: unknown): value is Role {
  return value === "Admin" || value === "Engineer" || value === "Reviewer" || value === "Manager";
}

export function validateStoredState(value: unknown): value is AppState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AppState>;
  const isText = (item: unknown) => typeof item === "string";
  const isTimestamp = (item: unknown) => isText(item) && !Number.isNaN(Date.parse(item));
  const isOptionalDate = (item: unknown) => item === undefined || isDateString(item);
  const isActivity = (item: unknown): item is Activity => Boolean(item && typeof item === "object" && isText((item as Activity).id) && isText((item as Activity).event) && isText((item as Activity).detail) && isTimestamp((item as Activity).timestamp) && (isRole((item as Activity).actor) || (item as Activity).actor === "system"));
  const isCertificate = (item: unknown): item is Certificate => {
    if (!item || typeof item !== "object") return false;
    const certificate = item as Partial<Certificate>;
    return isText(certificate.id) && isText(certificate.number) && isDateString(certificate.issuedDate) && isDateString(certificate.expiryDate)
      && ["Pass", "Fail"].includes(certificate.result as string) && ["Valid", "Expired", "Revoked", "Superseded"].includes(certificate.status as string);
  };
  const isRecord = (item: unknown): item is AssetRecord => {
    if (!item || typeof item !== "object") return false;
    const record = item as Partial<AssetRecord>;
    return isText(record.id) && isText(record.assetRef) && ["equipment", "licence"].includes(record.recordType as string)
      && isText(record.assetType) && isText(record.site) && isText(record.owner) && ["Active", "Retired"].includes(record.status as string)
      && isTimestamp(record.createdAt) && isTimestamp(record.updatedAt)
      && (record.serialNo === undefined || isText(record.serialNo)) && (record.assignedEngineer === undefined || isText(record.assignedEngineer))
      && (record.inspectionIntervalMonths === undefined || (Number.isSafeInteger(record.inspectionIntervalMonths) && record.inspectionIntervalMonths > 0))
      && isOptionalDate(record.inspectionDueDate) && isOptionalDate(record.licenceIssuedDate) && isOptionalDate(record.licenceExpiryDate) && (record.remarks === undefined || isText(record.remarks)) && isOptionalDate(record.certificateIssuedDate) && isOptionalDate(record.certificateExpiryDate) && isOptionalDate(record.retirementDueDate)
      && (record.warranty === undefined || Boolean(record.warranty && typeof record.warranty === "object" && parseWarranty(record.warranty as Record<string, unknown>).warranty))
      && Array.isArray(record.certificates) && record.certificates.every(isCertificate) && Array.isArray(record.activity) && record.activity.every(isActivity);
  };
  const isInspection = (item: unknown): boolean => {
    if (!item || typeof item !== "object") return false;
    const inspection = item as Partial<Inspection>;
    return isText(inspection.id) && isText(inspection.assetId) && isText(inspection.inspector)
      && ["Draft", "Submitted", "Returned", "Approved", "Issued"].includes(inspection.status as string)
      && Array.isArray(inspection.checklist) && inspection.checklist.every((check) => Boolean(check && typeof check === "object" && isText((check as ChecklistItem).id) && isText((check as ChecklistItem).label) && ((check as ChecklistItem).section === undefined || isText((check as ChecklistItem).section)) && ["pass", "fail", "na", "pending"].includes((check as ChecklistItem).result)))
      && (inspection.title === undefined || isText(inspection.title))
      && (inspection.connection === undefined || isConnectionSpec(inspection.connection)) && (inspection.job === undefined || isTallyJob(inspection.job)) && (inspection.joints === undefined || (Array.isArray(inspection.joints) && inspection.joints.every(isJoint)))
      && (!inspection.photos || (Array.isArray(inspection.photos) && inspection.photos.every((photo) => Boolean(photo && typeof photo === "object" && isText(photo.id) && isText(photo.name) && isText(photo.type) && isText(photo.dataUrl) && typeof photo.bytes === "number" && photo.bytes <= 200 * 1024))))
      && (inspection.signature === undefined || (typeof inspection.signature === "string" && inspection.signature.startsWith("data:image/png;base64,") && inspection.signature.length <= 90_000))
      && isText(inspection.notes) && isTimestamp(inspection.createdAt) && isTimestamp(inspection.updatedAt) && isOptionalDate(inspection.nextInspectionDate)
      && (inspection.submittedAt === undefined || isTimestamp(inspection.submittedAt)) && (inspection.reviewedAt === undefined || isTimestamp(inspection.reviewedAt));
  };
  const isAlert = (item: unknown): boolean => {
    if (!item || typeof item !== "object") return false;
    const alert = item as Partial<Alert>;
    return isText(alert.id) && isText(alert.occurrenceKey) && ["deadline", "review", "certificate", "system"].includes(alert.type as string)
      && isText(alert.event) && isTimestamp(alert.timestamp) && ["info", "warning", "critical"].includes(alert.severity as string) && ["open", "resolved", "history"].includes(alert.status as string)
      && isOptionalDate(alert.dueDate) && (alert.acknowledgedAt === undefined || isTimestamp(alert.acknowledgedAt))
      && (alert.emailSentAt === undefined || isTimestamp(alert.emailSentAt))
      && (alert.whatsappSentAt === undefined || isTimestamp(alert.whatsappSentAt));
  };
  const isSaving = (item: unknown): boolean => {
    if (!item || typeof item !== "object") return false;
    const saving = item as Partial<Saving>;
    return isText(saving.id) && isText(saving.number) && isText(saving.unit) && isDateString(saving.issuedDate) && isTimestamp(saving.createdAt) && isTimestamp(saving.updatedAt)
      && Boolean(parseSaving(item as Record<string, unknown>).saving);
  };
  const counters = candidate.savingCounters;
  return candidate.version === STORAGE_VERSION
    && (candidate.savings === undefined || (Array.isArray(candidate.savings) && candidate.savings.every(isSaving)))
    && (candidate.connections === undefined || (Array.isArray(candidate.connections) && candidate.connections.every(isConnectionSpec)))
    && (candidate.equipment === undefined || (Array.isArray(candidate.equipment) && candidate.equipment.every(isEquipment)))
    && (counters === undefined || (Boolean(counters) && typeof counters === "object" && !Array.isArray(counters) && Object.values(counters).every((count) => Number.isSafeInteger(count) && count >= 0)))
    && isDateString(candidate.demoDate)
    && isRole(candidate.role)
    && Array.isArray(candidate.records) && candidate.records.every(isRecord)
    && Array.isArray(candidate.inspections) && candidate.inspections.every(isInspection)
    && Array.isArray(candidate.alerts) && candidate.alerts.every(isAlert)
    && Array.isArray(candidate.activity) && candidate.activity.every(isActivity);
}

export function trimValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

export function parseDateCell(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (isDateString(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return todayString(value);
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 2_958_465) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const date = new Date(excelEpoch + value * 86_400_000);
    return Number.isNaN(date.getTime()) ? undefined : todayString(date);
  }
  return undefined;
}

function parseRecordType(value: unknown): RecordType | undefined {
  const normalized = trimValue(value).toLowerCase();
  return normalized === "equipment" || normalized === "licence" ? normalized : undefined;
}

function parseStatus(value: unknown): AssetStatus | undefined {
  const normalized = trimValue(value).toLowerCase();
  if (!normalized || normalized === "active") return "Active";
  if (normalized === "retired") return "Retired";
  return undefined;
}

function importError(row: number, message: string, field?: string, raw?: Record<string, unknown>): ImportError {
  return { row, field, message, raw };
}

export function normalizeRegisterRow(raw: Record<string, unknown>, row: number): { row?: RegisterRow; error?: ImportError } {
  const assetRef = trimValue(raw.asset_ref);
  const recordType = parseRecordType(raw.record_type);
  const assetType = trimValue(raw.asset_type);
  const site = trimValue(raw.site);
  const owner = trimValue(raw.owner);
  if (!assetRef) return { error: importError(row, "asset_ref is required", "asset_ref", raw) };
  if (!recordType) return { error: importError(row, "record_type must be equipment or licence", "record_type", raw) };
  if (!assetType) return { error: importError(row, "asset_type is required", "asset_type", raw) };
  if (!site) return { error: importError(row, "site is required", "site", raw) };
  if (!owner) return { error: importError(row, "owner is required", "owner", raw) };
  const status = parseStatus(raw.status);
  if (!status) return { error: importError(row, "status must be Active or Retired", "status", raw) };
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value.trimStart().startsWith("=")) {
      return { error: importError(row, "formulas are not allowed", key, raw) };
    }
  }
  const dateFields = ["inspection_due_date", "licence_expiry_date", "certificate_issued_date", "certificate_expiry_date", "retirement_due_date"] as const;
  const dates: Partial<Record<(typeof dateFields)[number], string>> = {};
  for (const field of dateFields) {
    const value = raw[field];
    if (value === undefined || value === null || value === "") continue;
    const parsed = parseDateCell(value);
    if (!parsed) return { error: importError(row, `${field} must be a valid YYYY-MM-DD date`, field, raw) };
    dates[field] = parsed;
  }
  const certificateFields = ["certificate_no", "certificate_issued_date", "certificate_expiry_date"] as const;
  if (certificateFields.some((field) => trimValue(raw[field])) && certificateFields.some((field) => !trimValue(raw[field]))) {
    return { error: importError(row, "certificate_no, issued date and expiry date must be supplied together", "certificate_no", raw) };
  }
  if (dates.certificate_issued_date && dates.certificate_expiry_date && dates.certificate_expiry_date < dates.certificate_issued_date) {
    return { error: importError(row, "certificate expiry must be on or after issue date", "certificate_expiry_date", raw) };
  }
  const intervalText = trimValue(raw.inspection_interval_months);
  const inspectionIntervalMonths = intervalText ? Number(intervalText) : undefined;
  if (intervalText && (inspectionIntervalMonths === undefined || !Number.isInteger(inspectionIntervalMonths) || inspectionIntervalMonths <= 0)) {
    return { error: importError(row, "inspection_interval_months must be a positive whole number", "inspection_interval_months", raw) };
  }
  return {
    row: {
      assetRef,
      recordType,
      assetType,
      site,
      owner,
      serialNo: trimValue(raw.serial_no) || undefined,
      assignedEngineer: trimValue(raw.assigned_engineer) || undefined,
      inspectionDueDate: dates.inspection_due_date,
      inspectionIntervalMonths,
      licenceExpiryDate: dates.licence_expiry_date,
      certificateNo: trimValue(raw.certificate_no) || undefined,
      certificateIssuedDate: dates.certificate_issued_date,
      certificateExpiryDate: dates.certificate_expiry_date,
      retirementDueDate: dates.retirement_due_date,
      status,
    },
  };
}

export function validateRegisterRows(rows: Record<string, unknown>[], existingAssetRefs: string[] = []): ImportPreview {
  const errors: ImportError[] = [];
  const duplicates: ImportError[] = [];
  const validRows: RegisterRow[] = [];
  const seen = new Set(existingAssetRefs.map((value) => value.trim().toLowerCase()));
  rows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const normalized = normalizeRegisterRow(raw, rowNumber);
    if (normalized.error) {
      errors.push(normalized.error);
      return;
    }
    const key = normalized.row!.assetRef.toLowerCase();
    if (seen.has(key)) {
      duplicates.push(importError(rowNumber, "duplicate asset_ref skipped without overwrite", "asset_ref", raw));
      return;
    }
    seen.add(key);
    validRows.push(normalized.row!);
  });
  return { totalRows: rows.length, validRows, errors, duplicates };
}

export function rowToRecord(row: RegisterRow, actor: Role = "Admin", timestamp = nowIso()): AssetRecord {
  return {
    ...row,
    id: makeId("asset"),
    certificates: row.certificateNo && row.certificateIssuedDate && row.certificateExpiryDate ? [{
      id: makeId("cert"), number: row.certificateNo, issuedDate: row.certificateIssuedDate, expiryDate: row.certificateExpiryDate,
      result: "Pass", status: "Valid",
    }] : [],
    activity: [{ id: makeId("activity"), event: "Imported", detail: "Register row imported", actor, timestamp }],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function deadlineTier(days: number): DeadlineTier | undefined {
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "due7";
  if (days <= 30) return "due30";
  return undefined;
}

export function effectiveCertificateStatus(certificate: Certificate, demoDate: string): CertificateStatus {
  return certificate.status === "Valid" && certificate.expiryDate < demoDate ? "Expired" : certificate.status;
}

// tiers limits which tiers raise an alert; unset means all four.
type Deadline = { key: string; event: string; date: string; severity: AlertSeverity; tiers?: DeadlineTier[] };

function recordDeadlines(record: AssetRecord, demoDate: string): Deadline[] {
  if (record.status === "Retired") return [];
  const deadlines: Deadline[] = [];
  if (record.inspectionDueDate) deadlines.push({ key: "inspection", event: "Inspection due", date: record.inspectionDueDate, severity: "warning" });
  if (record.licenceExpiryDate) deadlines.push({ key: "licence", event: IS_FLS ? "Certificate expiry" : "Licence expiry", date: record.licenceExpiryDate, severity: "critical" });
  // FLS renews by its Due Date (expiry - 15): alerting on that day and after it gives the 30/15/7/0-day reminders the sheet's owner asked for.
  // Once the certificate has expired, its expiry alert says it all, so the renewal one stops.
  if (IS_FLS && record.licenceExpiryDate && record.licenceExpiryDate >= demoDate) deadlines.push({ key: "renewal", event: "Renewal due", date: addDays(record.licenceExpiryDate, -FLS_DUE_LEAD_DAYS), severity: "warning", tiers: ["today", "overdue"] });
  const currentCertificate = [...record.certificates].reverse().find((certificate) => certificate.status === "Valid" || certificate.status === "Expired");
  if (currentCertificate) deadlines.push({ key: `certificate:${currentCertificate.id}`, event: "Certificate expiry", date: currentCertificate.expiryDate, severity: "critical" });
  if (record.retirementDueDate) deadlines.push({ key: "retirement", event: "Retirement due", date: record.retirementDueDate, severity: "warning" });
  // Only typed-in warranties, and only until they end: an expired 2018 warranty is history, not an action.
  const warranty = record.warranty && warrantyFor(record, demoDate);
  if (warranty?.status === "Valid") deadlines.push({ key: "warranty", event: "Warranty expiry", date: warranty.validUntil, severity: "warning" });
  return deadlines;
}

// The most urgent obligation on a record, using the same dates as the alert tiers.
export function nextDeadline(record: AssetRecord, demoDate: string): (Deadline & { days: number }) | undefined {
  return recordDeadlines(record, demoDate).map((deadline) => ({ ...deadline, days: dateDiffDays(deadline.date, demoDate) })).sort((a, b) => a.days - b.days)[0];
}

const dayCount = (days: number) => `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`;

// Short timing for list rows: "Today", "In 30 days", "3 days overdue".
export function deadlineWhen(days: number): string {
  return days === 0 ? "Today" : days > 0 ? `In ${dayCount(days)}` : `${dayCount(days)} overdue`;
}

// Names the obligation, not just the timing: "Retirement due in 30 days", "Licence expired 2 days ago".
export function deadlineLabel({ event, days }: { event: string; days: number }): string {
  const noun = event.split(" ")[0];
  const expires = event.endsWith("expiry");
  if (days < 0) return expires ? `${noun} expired ${dayCount(days)} ago` : `${noun} ${dayCount(days)} overdue`;
  return `${noun} ${expires ? "expires" : "due"} ${days === 0 ? "today" : `in ${dayCount(days)}`}`;
}

export function recalculateAlerts(state: AppState, timestamp = nowIso()): AppState {
  const next = state.alerts.map((alert) => ({ ...alert }));
  const currentKeys = new Set<string>();
  for (const record of state.records) {
    for (const certificate of record.certificates) {
      if (effectiveCertificateStatus(certificate, state.demoDate) === "Expired" && !next.some((alert) => alert.occurrenceKey === `certificate:${certificate.id}:Expired`)) next.push(certificateAlert(record, { ...certificate, status: "Expired" }, "Certificate expired", timestamp));
    }
    for (const deadline of recordDeadlines(record, state.demoDate)) {
      const tier = deadlineTier(dateDiffDays(deadline.date, state.demoDate));
      if (!tier || (deadline.tiers && !deadline.tiers.includes(tier))) continue;
      const occurrenceKey = `${record.id}:${deadline.key}:${deadline.date}`;
      currentKeys.add(occurrenceKey);
      const sameTier = next.find((alert) => alert.occurrenceKey === occurrenceKey && alert.tier === tier && alert.status === "open");
      if (sameTier) { sameTier.owner = record.owner; sameTier.assetRef = record.assetRef; continue; }
      next.forEach((alert) => {
        if (alert.occurrenceKey === occurrenceKey && alert.status === "open") alert.status = "resolved";
      });
      next.push({ id: makeId("alert"), occurrenceKey, type: "deadline", event: deadline.event, assetId: record.id, assetRef: record.assetRef, owner: record.owner, dueDate: deadline.date, timestamp, severity: tier === "overdue" ? "critical" : deadline.severity, tier, status: "open" });
    }
  }
  // AMS: an instrument's calibration due date alerts like any other deadline.
  for (const item of state.equipment ?? []) {
    const tier = deadlineTier(dateDiffDays(item.calibrationDue, state.demoDate));
    if (!tier) continue;
    const occurrenceKey = `${item.id}:calibration:${item.calibrationDue}`;
    currentKeys.add(occurrenceKey);
    const assetRef = `${item.kind} ${item.serial}`;
    if (next.some((alert) => alert.occurrenceKey === occurrenceKey && alert.tier === tier && alert.status === "open")) continue;
    next.forEach((alert) => { if (alert.occurrenceKey === occurrenceKey && alert.status === "open") alert.status = "resolved"; });
    next.push({ id: makeId("alert"), occurrenceKey, type: "deadline", event: "Calibration due", assetRef, owner: item.model, dueDate: item.calibrationDue, timestamp, severity: tier === "overdue" ? "critical" : "warning", tier, status: "open" });
  }
  next.forEach((alert) => {
    if (alert.type === "deadline" && alert.status === "open" && !currentKeys.has(alert.occurrenceKey)) alert.status = "resolved";
  });
  return { ...state, alerts: next };
}

function activity(event: string, detail: string, actor: Role | "system", timestamp: string): Activity {
  return { id: makeId("activity"), event, detail, actor, timestamp };
}

function certificateAlert(record: AssetRecord, certificate: Certificate, event: string, timestamp: string): Alert {
  return { id: makeId("alert"), occurrenceKey: `certificate:${certificate.id}:${certificate.status}`, type: "certificate", event, assetId: record.id, assetRef: record.assetRef, owner: record.owner, dueDate: certificate.expiryDate, timestamp, severity: certificate.status === "Revoked" || certificate.status === "Expired" ? "critical" : "info", status: "history" };
}

export function importRows(state: AppState, rows: RegisterRow[], actor = state.role, timestamp = nowIso()): AppState {
  if (!rows.length) return state;
  if (state.records.length + rows.length > 500) throw new Error("The demo is limited to 500 total register records. No rows were saved.");
  const seen = new Set(state.records.map((record) => record.assetRef.trim().toLowerCase()));
  for (const row of rows) {
    const key = row.assetRef.trim().toLowerCase();
    if (seen.has(key)) throw new Error("The register changed since this preview. Preview the file again to skip duplicates.");
    seen.add(key);
  }
  const imported = rows.map((row) => rowToRecord(row, actor, timestamp));
  const next: AppState = { ...state, records: [...state.records, ...imported], activity: [activity("Register imported", `${rows.length} record${rows.length === 1 ? "" : "s"} added`, actor, timestamp), ...state.activity] };
  return recalculateAlerts(next, timestamp);
}

// The fields an FLS sheet row carries; the import preview compares the same ones to find updates.
export const SYNCED_FIELDS = ["site", "owner", "licenceIssuedDate", "licenceExpiryDate", "remarks", "status"] as const;

// An updated FLS sheet re-uploaded: matching buildings take the sheet's values. Unmatched rows are ignored; importRows adds those.
export function updateRecords(state: AppState, rows: RegisterRow[], actor = state.role, timestamp = nowIso()): AppState {
  if (!rows.length) return state;
  const byRef = new Map(rows.map((row) => [row.assetRef.trim().toLowerCase(), row]));
  const event = activity("Register synced", `${rows.length} record${rows.length === 1 ? "" : "s"} updated from the sheet`, actor, timestamp);
  const records = state.records.map((record) => {
    const row = byRef.get(record.assetRef.trim().toLowerCase());
    if (!row) return record;
    const fields = Object.fromEntries(SYNCED_FIELDS.map((field) => [field, row[field]]));
    return { ...record, ...fields, activity: [{ ...event, id: makeId("activity"), detail: "Updated from the sheet" }, ...record.activity], updatedAt: timestamp };
  });
  return recalculateAlerts({ ...state, records, activity: [event, ...state.activity] }, timestamp);
}

export function getRecord(state: AppState, assetId: string): AssetRecord | undefined {
  return state.records.find((record) => record.id === assetId);
}

const DEFAULT_CHECKLIST = ["Identity and markings legible", "Components free from visible damage", "Fixings and anchor points secure", "Storage and use conditions acceptable"];

// FLS inspections use one of the service provider's PPM checklists; Kee's use the default four checks.
export function createInspection(state: AppState, assetId: string, actor = state.role, timestamp = nowIso(), template?: ChecklistTemplate): { state: AppState; inspection: Inspection } {
  const record = getRecord(state, assetId);
  if (record?.status !== "Active") throw new Error("Choose an active record to inspect.");
  const checklist: ChecklistItem[] = template ? checklistFrom(template) : DEFAULT_CHECKLIST.map((label, index) => ({ id: `check-${index + 1}`, label, result: "pending" }));
  const inspection: Inspection = { id: makeId("inspection"), assetId, inspector: record.assignedEngineer || actor, ...(template && { title: template.title }), checklist, notes: "", status: "Draft", createdAt: timestamp, updatedAt: timestamp };
  return { state: { ...state, inspections: [inspection, ...state.inspections] }, inspection };
}

export function updateInspection(state: AppState, id: string, patch: Partial<Pick<Inspection, "checklist" | "job" | "joints" | "notes" | "photos" | "signature">>, timestamp = nowIso()): AppState {
  if (patch.photos && (patch.photos.some((photo) => photo.bytes > 200 * 1024) || patch.photos.reduce((total, photo) => total + photo.bytes, 0) > 1024 * 1024)) throw new Error("Evidence exceeds the local photo limit.");
  return { ...state, inspections: state.inspections.map((item) => item.id === id && (item.status === "Draft" || item.status === "Returned") ? { ...item, ...patch, updatedAt: timestamp } : item) };
}

// Only never-submitted drafts can go; anything reviewed stays in the audit trail.
export function deleteInspection(state: AppState, id: string): AppState {
  return { ...state, inspections: state.inspections.filter((item) => item.id !== id || item.status !== "Draft") };
}

// A tally sheet is ready once every joint is graded; a checklist once every item is answered.
const isComplete = (inspection: Inspection) => inspection.joints ? tallyComplete(inspection) : inspection.checklist.length > 0 && inspection.checklist.every((item) => item.result !== "pending");

export function submitInspection(state: AppState, id: string, timestamp = nowIso()): AppState {
  const inspection = state.inspections.find((item) => item.id === id);
  if (!inspection || (inspection.status !== "Draft" && inspection.status !== "Returned") || !isComplete(inspection)) return state;
  // A tally sheet needs every instrument it lists in calibration, and keeps a copy of them for its report.
  const job = inspection.job && { ...inspection.job, equipment: (state.equipment ?? []).filter((item) => inspection.job!.equipmentIds.includes(item.id)) };
  if (job && expiredEquipment(job.equipment, job.equipmentIds, state.demoDate).length) return state;
  const next: AppState = { ...state, inspections: state.inspections.map((item) => item.id === id ? { ...item, ...(job && { job }), status: "Submitted", submittedAt: timestamp, updatedAt: timestamp } : item), alerts: state.alerts.map((alert) => alert.occurrenceKey.startsWith(`returned:${id}`) ? { ...alert, status: "resolved" as const } : alert) };
  const record = getRecord(state, inspection.assetId);
  if (!record) return next;
  const what = inspection.joints ? "Tally sheet" : "Inspection";
  const alert: Alert = { id: makeId("alert"), occurrenceKey: `review:${id}:${timestamp}`, type: "review", event: `${what} submitted for review`, assetId: record.id, assetRef: record.assetRef, owner: record.owner, timestamp, severity: "info", status: "open" };
  return { ...next, records: next.records.map((item) => item.id === record.id ? { ...item, activity: [activity(`${what} submitted`, "Awaiting review", state.role, timestamp), ...item.activity] } : item), alerts: [alert, ...next.alerts], activity: [activity(`${what} submitted`, `${record.assetRef} awaiting review`, state.role, timestamp), ...state.activity] };
}

export function returnInspection(state: AppState, id: string, comment: string, actor = state.role, timestamp = nowIso()): AppState {
  const inspection = state.inspections.find((item) => item.id === id);
  if (!inspection || inspection.status !== "Submitted" || !comment.trim()) return state;
  const record = getRecord(state, inspection.assetId);
  const returnedAlert: Alert | undefined = record ? { id: makeId("alert"), occurrenceKey: `returned:${id}:${timestamp}`, type: "review", event: "Inspection returned for correction", assetId: record.id, assetRef: record.assetRef, owner: record.owner, timestamp, severity: "warning", status: "open" } : undefined;
  return { ...state, inspections: state.inspections.map((item) => item.id === id ? { ...item, status: "Returned", reviewerComment: comment.trim(), reviewedAt: timestamp, updatedAt: timestamp } : item), alerts: [...(returnedAlert ? [returnedAlert] : []), ...state.alerts.map((alert) => alert.occurrenceKey.startsWith(`review:${id}`) ? { ...alert, status: "resolved" as const } : alert)], activity: [activity("Inspection returned", comment.trim(), actor, timestamp), ...state.activity] };
}

export function approveInspection(state: AppState, id: string, expiryDate: string, actor = state.role, timestamp = nowIso()): AppState {
  const inspection = state.inspections.find((item) => item.id === id);
  // A tally sheet issues its report with its rejects listed on it; a checklist needs every item passed or N/A.
  if (!inspection || !isComplete(inspection) || inspection.status !== "Submitted" || !isDateString(expiryDate) || expiryDate < state.demoDate || inspection.checklist.some((item) => item.result === "fail")) return state;
  if (inspection.certificateId) return state;
  const record = getRecord(state, inspection.assetId);
  if (!record) return state;
  const number = `CERT-${state.demoDate.replaceAll("-", "")}-${String(state.records.reduce((total, item) => total + item.certificates.length, 0) + 1).padStart(4, "0")}`;
  const certificate: Certificate = { id: makeId("cert"), number, issuedDate: state.demoDate, expiryDate, result: "Pass", status: "Valid", sourceInspectionId: id };
  const issued = inspection.joints ? "Report issued" : "Certificate issued";
  const nextInspectionDate = record.inspectionIntervalMonths ? addMonthsClamped(state.demoDate, record.inspectionIntervalMonths) : undefined;
  const next: AppState = {
    ...state,
    inspections: state.inspections.map((item) => item.id === id ? { ...item, status: "Issued", certificateId: certificate.id, nextInspectionDate, reviewedAt: timestamp, updatedAt: timestamp } : item),
    records: state.records.map((item) => item.id === record.id ? { ...item, inspectionDueDate: nextInspectionDate, certificates: [...item.certificates.map((cert) => (cert.status === "Valid" || cert.status === "Expired") ? { ...cert, status: "Superseded" as const } : cert), certificate], certificateNo: certificate.number, certificateIssuedDate: certificate.issuedDate, certificateExpiryDate: certificate.expiryDate, activity: [activity(issued, certificate.number, actor, timestamp), ...item.activity], updatedAt: timestamp } : item),
    alerts: [certificateAlert(record, certificate, issued, timestamp), ...record.certificates.filter((cert) => cert.status === "Valid" || cert.status === "Expired").map((cert) => certificateAlert(record, { ...cert, status: "Superseded" }, "Certificate superseded", timestamp)), ...state.alerts.map((alert): Alert => alert.occurrenceKey.startsWith(`review:${id}`) || alert.occurrenceKey.startsWith(`returned:${id}`) ? { ...alert, status: "resolved" } : alert)],
    activity: [activity(issued, `${record.assetRef} · ${certificate.number}`, actor, timestamp), ...state.activity],
  };
  return recalculateAlerts(next, timestamp);
}

// FLS: the client representative signs off a PPM checklist. No certificate comes of it; Not Ok items are kept as found and open one alert to follow up.
export function approveChecklist(state: AppState, id: string, actor = state.role, timestamp = nowIso()): AppState {
  const inspection = state.inspections.find((item) => item.id === id);
  const record = inspection && getRecord(state, inspection.assetId);
  if (!inspection || !record || inspection.status !== "Submitted" || inspection.checklist.some((item) => item.result === "pending")) return state;
  const notOk = inspection.checklist.filter((item) => item.result === "fail").length;
  const event = activity("Checklist approved", `${record.assetRef} · ${inspection.title ?? "Inspection"}${notOk ? ` · ${notOk} Not Ok` : ""}`, actor, timestamp);
  return {
    ...state,
    inspections: state.inspections.map((item) => item.id === id ? { ...item, status: "Approved", reviewedAt: timestamp, updatedAt: timestamp } : item),
    records: state.records.map((item) => item.id === record.id ? { ...item, activity: [event, ...item.activity], updatedAt: timestamp } : item),
    alerts: [
      ...(notOk ? [{ id: makeId("alert"), occurrenceKey: `defects:${id}`, type: "review" as const, event: `${inspection.title ?? "Checklist"}: ${notOk} Not Ok item${notOk === 1 ? "" : "s"}`, assetId: record.id, assetRef: record.assetRef, owner: record.owner, timestamp, severity: "warning" as const, status: "open" as const }] : []),
      ...state.alerts.map((alert): Alert => alert.occurrenceKey.startsWith(`review:${id}`) || alert.occurrenceKey.startsWith(`returned:${id}`) ? { ...alert, status: "resolved" } : alert),
    ],
    activity: [event, ...state.activity],
  };
}

export function setRole(state: AppState, role: Role): AppState {
  return { ...state, role };
}

export function setDemoDate(state: AppState, demoDate: string, timestamp = nowIso()): AppState {
  if (!isDateString(demoDate)) return state;
  return recalculateAlerts({ ...state, demoDate, activity: [activity("Demo date changed", demoDate, state.role, timestamp), ...state.activity] }, timestamp);
}

export function setDeadlineShortcut(state: AppState, assetId: string, daysFromToday: number, timestamp = nowIso()): AppState {
  const record = getRecord(state, assetId);
  if (!record) return state;
  const inspectionDueDate = addDays(state.demoDate, daysFromToday);
  return recalculateAlerts({ ...state, records: state.records.map((item) => item.id === assetId ? { ...item, inspectionDueDate, updatedAt: timestamp } : item) }, timestamp);
}

export function acknowledgeAlert(state: AppState, alertId: string, actor = state.role, timestamp = nowIso()): AppState {
  return { ...state, alerts: state.alerts.map((alert) => alert.id === alertId && alert.status === "open" ? { ...alert, acknowledgedBy: actor, acknowledgedAt: timestamp } : alert) };
}

export function revokeCertificate(state: AppState, assetId: string, certificateId: string, actor = state.role, timestamp = nowIso()): AppState {
  return changeCertificateStatus(state, assetId, certificateId, "Revoked", actor, timestamp);
}

export function changeCertificateStatus(state: AppState, assetId: string, certificateId: string, status: "Revoked" | "Superseded", actor = state.role, timestamp = nowIso()): AppState {
  const record = getRecord(state, assetId);
  const certificate = record?.certificates.find((item) => item.id === certificateId);
  if (!record || !certificate || certificate.status === "Revoked" || certificate.status === "Superseded") return state;
  const event = `Certificate ${status.toLowerCase()}`;
  return recalculateAlerts({ ...state, records: state.records.map((item) => item.id === assetId ? { ...item, certificates: item.certificates.map((cert) => cert.id === certificateId ? { ...cert, status, token: undefined, verifyUrl: undefined, tokenIssuedAt: undefined } : cert), activity: [activity(event, certificate.number, actor, timestamp), ...item.activity], updatedAt: timestamp } : item), alerts: [certificateAlert(record, { ...certificate, status }, event, timestamp), ...state.alerts], activity: [activity(event, `${record.assetRef} · ${certificate.number}`, actor, timestamp), ...state.activity] }, timestamp);
}

const WARRANTY_OPTIONAL = ["contractNo", "project", "scope", "mainContractor"] as const;

// Used for the typed-in form and for stored or restored workspaces, so it trusts nothing.
export function parseWarranty(raw: Record<string, unknown>): { warranty?: Warranty; error?: string } {
  const number = trimValue(raw.number);
  const product = trimValue(raw.product);
  if (!number || number.length > 60 || /[<>]/.test(number)) return { error: "Warranty number is required (up to 60 characters, no < or >)." };
  if (!product || product.length > 160) return { error: "Product is required (up to 160 characters)." };
  if (!isDateString(raw.warrantyDate)) return { error: "Warranty date must be a valid date." };
  if (typeof raw.years !== "number" || !Number.isInteger(raw.years) || raw.years < 1 || raw.years > 25) return { error: "Duration must be 1 to 25 whole years." };
  if (raw.revokedDate !== undefined && !isDateString(raw.revokedDate)) return { error: "Revoked date must be a valid date." };
  const warranty: Warranty = { number, product, warrantyDate: raw.warrantyDate, years: raw.years, ...(raw.revokedDate ? { revokedDate: raw.revokedDate } : {}) };
  for (const field of WARRANTY_OPTIONAL) {
    if (raw[field] !== undefined && typeof raw[field] !== "string") return { error: `${field} must be text.` };
    const value = trimValue(raw[field]);
    if (value.length > 160) return { error: "Contract, project, scope and contractor are limited to 160 characters." };
    if (value) warranty[field] = value;
  }
  return { warranty };
}

export type WarrantyDetails = Warranty & { validUntil: string; status: "Valid" | "Expired" | "Revoked"; typedIn: boolean };

export const warrantyProduct = (assetType: string) => /horizontal lifeline/i.test(assetType) ? "KeeLine® Horizontal Lifeline System" : assetType;

// One warranty per asset: the typed-in one, else 5 years from the first certificate so renewals don't restart it.
export function warrantyFor(record: AssetRecord, demoDate: string): WarrantyDetails | undefined {
  const firstCertificate = record.certificates.map((item) => item.issuedDate).sort()[0];
  const warranty = record.warranty ?? (firstCertificate ? { number: `WAR-${record.assetRef}`, product: warrantyProduct(record.assetType), warrantyDate: firstCertificate, years: 5 } : undefined);
  if (!warranty) return undefined;
  const validUntil = addMonthsClamped(warranty.warrantyDate, warranty.years * 12);
  return { ...warranty, validUntil, status: record.warranty?.revokedDate ? "Revoked" : demoDate > validUntil ? "Expired" : "Valid", typedIn: Boolean(record.warranty) };
}

// A RegisterRow adds the asset first, so an old warranty for a system not yet in the register is one save.
export function saveWarranty(state: AppState, asset: string | RegisterRow, warranty: Warranty, actor = state.role, timestamp = nowIso()): AppState {
  const withAsset = typeof asset === "string" ? state : importRows(state, [asset], actor, timestamp);
  const record = typeof asset === "string" ? getRecord(withAsset, asset) : withAsset.records.find((item) => item.assetRef === asset.assetRef);
  if (!record) throw new Error("Choose a register record for this warranty.");
  if (record.warranty?.revokedDate) throw new Error(`${record.assetRef}'s warranty is revoked and can't be changed.`);
  const key = warranty.number.toLowerCase();
  if (withAsset.records.some((item) => item.id !== record.id && warrantyFor(item, state.demoDate)?.number.toLowerCase() === key)) throw new Error(`Warranty ${warranty.number} is already on another record.`);
  const event = activity(record.warranty ? "Warranty updated" : "Warranty added", `${record.assetRef} · ${warranty.number}`, actor, timestamp);
  return recalculateAlerts({ ...withAsset, records: withAsset.records.map((item) => item.id === record.id ? { ...item, warranty, activity: [event, ...item.activity], updatedAt: timestamp } : item), activity: [event, ...withAsset.activity] }, timestamp);
}

// Revoking keeps the warranty (a derived one is stored first) so its QR check says Revoked; it can't be undone.
export function revokeWarranty(state: AppState, assetId: string, actor = state.role, timestamp = nowIso()): AppState {
  const record = getRecord(state, assetId);
  const current = record && warrantyFor(record, state.demoDate);
  if (!record || !current || current.status === "Revoked") return state;
  const { validUntil, status, typedIn, ...warranty } = current;
  const event = activity("Warranty revoked", `${record.assetRef} · ${warranty.number}`, actor, timestamp);
  return recalculateAlerts({ ...state, records: state.records.map((item) => item.id === assetId ? { ...item, warranty: { ...warranty, revokedDate: state.demoDate }, activity: [event, ...item.activity], updatedAt: timestamp } : item), activity: [event, ...state.activity] }, timestamp);
}

// For typed-in mistakes; a record with a certificate falls back to the warranty derived from it.
export function removeWarranty(state: AppState, assetId: string, actor = state.role, timestamp = nowIso()): AppState {
  const record = getRecord(state, assetId);
  if (!record?.warranty || record.warranty.revokedDate) return state;
  const event = activity("Warranty removed", `${record.assetRef} · ${record.warranty.number}`, actor, timestamp);
  return recalculateAlerts({ ...state, records: state.records.map((item) => item.id === assetId ? { ...item, warranty: undefined, activity: [event, ...item.activity], updatedAt: timestamp } : item), activity: [event, ...state.activity] }, timestamp);
}

// Default factors are worked back from Kee Safety's Q3 2026 initiatives deck (63.08 kg ÷ 29 pallets, 3,105.08 kg ÷ 4,900 km).
// They stay editable on every saving; confirm their sources with Kee Safety before relying on them.
export const SAVING_TYPES: Record<SavingType, { label: string; unit: string; factor?: number }> = {
  paper: { label: "Paper recycling", unit: "kg", factor: 0.94 },
  pallets: { label: "Pallet reuse", unit: "pallets", factor: 2.1752 },
  deliveries: { label: "Delivery consolidation", unit: "km avoided", factor: 0.6337 },
  other: { label: "Other", unit: "" },
};

export type SavingInput = Pick<Saving, "type" | "date" | "quantity" | "unit" | "factor" | "description" | "site" | "evidence" | "costSaving">;

const SAVING_OPTIONAL = ["description", "site", "evidence"] as const;
const isAmount = (value: unknown, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;

// Used for the typed-in form and for stored or restored workspaces, so it trusts nothing.
export function parseSaving(raw: Record<string, unknown>): { saving?: SavingInput; error?: string } {
  const type = raw.type;
  if (typeof type !== "string" || !Object.hasOwn(SAVING_TYPES, type)) return { error: "Saving type must be Paper recycling, Pallet reuse, Delivery consolidation or Other." };
  const savingType = type as SavingType;
  if (!isDateString(raw.date)) return { error: "Date must be a valid date." };
  if (!isAmount(raw.quantity, 10_000_000) || raw.quantity === 0) return { error: "Quantity must be more than 0 (up to 10,000,000)." };
  if (!isAmount(raw.factor, 10_000)) return { error: "CO₂e factor must be 0 to 10,000 kg per unit." };
  if (raw.costSaving !== undefined && !isAmount(raw.costSaving, 10_000_000)) return { error: "Cost saving must be 0 to 10,000,000." };
  const unit = savingType === "other" ? trimValue(raw.unit) : SAVING_TYPES[savingType].unit;
  if (!unit || unit.length > 20 || /[<>]/.test(unit)) return { error: "Unit is required for Other (up to 20 characters, no < or >)." };
  const saving: SavingInput = { type: savingType, date: raw.date, quantity: raw.quantity, unit, factor: raw.factor, ...(raw.costSaving !== undefined ? { costSaving: raw.costSaving } : {}) };
  for (const field of SAVING_OPTIONAL) {
    if (raw[field] !== undefined && typeof raw[field] !== "string") return { error: `${field} must be text.` };
    const value = trimValue(raw[field]);
    if (value.length > 160 || /[<>]/.test(value)) return { error: "Description, site and evidence are limited to 160 characters, no < or >." };
    if (value) saving[field] = value;
  }
  return { saving };
}

// Rounded to grams so 560 × 0.94 reads 526.4, not 526.3999999.
export const savingKg = ({ quantity, factor }: Pick<Saving, "quantity" | "factor">) => Math.round(quantity * factor * 1000) / 1000;
export const totalKg = (savings: Saving[]) => Math.round(savings.reduce((sum, saving) => sum + savingKg(saving), 0) * 1000) / 1000;

// "2026-Q3", which sorts as text.
export const quarterOf = (date: string) => `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;
export const quarterLabel = (quarter: string) => `${quarter.slice(5)} ${quarter.slice(0, 4)}`;
export function quarterRange(quarter: string): [string, string] {
  const start = `${quarter.slice(0, 4)}-${String(Number(quarter.slice(6)) * 3 - 2).padStart(2, "0")}-01`;
  return [start, addDays(addMonthsClamped(start, 3), -1)];
}

// Adds when id is undefined. An edit keeps the number and issue date that may already be printed.
export function saveSaving(state: AppState, input: SavingInput, id?: string, actor = state.role, timestamp = nowIso()): AppState {
  const savings = state.savings ?? [];
  const existing = id === undefined ? undefined : savings.find((saving) => saving.id === id);
  if (id !== undefined && !existing) throw new Error("That saving no longer exists. Close the form and try again.");
  let counters = state.savingCounters ?? {};
  let base: Pick<Saving, "id" | "number" | "issuedDate" | "createdAt">;
  if (existing) base = { id: existing.id, number: existing.number, issuedDate: existing.issuedDate, createdAt: existing.createdAt };
  else {
    const year = state.demoDate.slice(0, 4);
    const prefix = `ENV-${year}-`;
    // The counter guards against reuse after a removal; the scan covers workspaces restored from older backups.
    const next = Math.max(counters[year] ?? 0, ...savings.filter((saving) => saving.number.startsWith(prefix)).map((saving) => Number(saving.number.slice(prefix.length)) || 0)) + 1;
    counters = { ...counters, [year]: next };
    base = { id: makeId("saving"), number: `${prefix}${String(next).padStart(3, "0")}`, issuedDate: state.demoDate, createdAt: timestamp };
  }
  const saving: Saving = { ...base, ...input, updatedAt: timestamp };
  const event = activity(existing ? "Saving updated" : "Saving recorded", `${saving.number} · ${SAVING_TYPES[saving.type].label} · ${savingKg(saving)} kg CO₂e`, actor, timestamp);
  return { ...state, savings: existing ? savings.map((item) => item.id === saving.id ? saving : item) : [saving, ...savings], savingCounters: counters, activity: [event, ...state.activity] };
}

export function removeSaving(state: AppState, id: string, actor = state.role, timestamp = nowIso()): AppState {
  const saving = state.savings?.find((item) => item.id === id);
  if (!saving) return state;
  return { ...state, savings: state.savings?.filter((item) => item.id !== id), activity: [activity("Saving removed", `${saving.number} · ${SAVING_TYPES[saving.type].label}`, actor, timestamp), ...state.activity] };
}

export type SavingsPreview = { totalRows: number; validRows: SavingInput[]; errors: ImportError[]; duplicates: ImportError[] };

// The type column takes the label the export writes ("Paper recycling") or the short key ("paper").
const SAVING_TYPE_NAMES = new Map(Object.entries(SAVING_TYPES).flatMap(([key, { label }]) => [[key, key], [label.toLowerCase(), key]]));
const cellNumber = (value: unknown) => typeof value === "number" ? value : trimValue(value) ? Number(trimValue(value).replaceAll(",", "")) : NaN;

// One row of the Sustainability export and import layout; a saving not yet in KTrack has no number or issue date.
export function savingToRaw(saving: SavingInput & Partial<Pick<Saving, "number" | "issuedDate">>): Record<SavingHeader, string | number> {
  return {
    certificate_no: saving.number ?? "", quarter: quarterLabel(quarterOf(saving.date)), date: saving.date, type: SAVING_TYPES[saving.type].label, description: saving.description ?? "",
    quantity: saving.quantity, unit: saving.unit, kg_co2e_per_unit: saving.factor, kg_co2e_saved: savingKg(saving), cost_saving_usd: saving.costSaving ?? "", site: saving.site ?? "", evidence: saving.evidence ?? "", issued_date: saving.issuedDate ?? "",
  };
}

const savingKey = (saving: SavingInput) => [saving.type, saving.date, saving.quantity, saving.unit, saving.description ?? ""].join("|").toLowerCase();

// Rows in the Sustainability export's layout. Nothing already in KTrack is overwritten: a known certificate number, or
// the same type, date, quantity and description, is skipped, so re-importing an export or a sample adds nothing twice.
// Every other row gets the next ENV number when imported. firstRow is the file row of the first data row; issues name the
// Savings sheet because they share one exception list with register rows.
export function validateSavingRows(rows: Record<string, unknown>[], existing: Saving[] = [], firstRow = 2): SavingsPreview {
  const errors: ImportError[] = [];
  const duplicates: ImportError[] = [];
  const validRows: SavingInput[] = [];
  const numbers = new Set(existing.map((saving) => saving.number.toLowerCase()));
  const keys = new Set(existing.map(savingKey));
  // Excel keeps formatted but empty rows at the bottom of a sheet; they are not mistakes.
  const filled = rows.map((raw, index) => ({ raw, rowNumber: index + firstRow })).filter(({ raw }) => Object.values(raw).some((value) => trimValue(value)));
  for (const { raw, rowNumber } of filled) {
    const number = trimValue(raw.certificate_no).toLowerCase();
    if (number && numbers.has(number)) { duplicates.push(importError(rowNumber, "certificate_no is already in KTrack; skipped without overwrite", "Savings · certificate_no", raw)); continue; }
    const parsed = parseSaving({
      type: SAVING_TYPE_NAMES.get(trimValue(raw.type).toLowerCase()), date: parseDateCell(raw.date), quantity: cellNumber(raw.quantity), unit: trimValue(raw.unit), factor: cellNumber(raw.kg_co2e_per_unit),
      costSaving: trimValue(raw.cost_saving_usd) ? cellNumber(raw.cost_saving_usd) : undefined, description: trimValue(raw.description), site: trimValue(raw.site), evidence: trimValue(raw.evidence),
    });
    if (!parsed.saving) { errors.push(importError(rowNumber, parsed.error ?? "Check this row.", "Savings", raw)); continue; }
    const key = savingKey(parsed.saving);
    if (keys.has(key)) { duplicates.push(importError(rowNumber, "the same saving (type, date, quantity, description) is already in KTrack or this file; skipped", "Savings", raw)); continue; }
    keys.add(key);
    if (number) numbers.add(number);
    validRows.push(parsed.saving);
  }
  return { totalRows: filled.length, validRows, errors, duplicates };
}

// Oldest first, so the new certificate numbers run in date order.
export function importSavings(state: AppState, rows: SavingInput[], actor = state.role, timestamp = nowIso()): AppState {
  return [...rows].sort((a, b) => a.date.localeCompare(b.date)).reduce((current, row) => saveSaving(current, row, undefined, actor, timestamp), state);
}

// Deletes the record with everything hanging off it; setting it to Retired is the way to keep its history.
export function deleteRecord(state: AppState, assetId: string, actor = state.role, timestamp = nowIso()): AppState {
  const record = getRecord(state, assetId);
  if (!record) return state;
  return recalculateAlerts({ ...state, records: state.records.filter((item) => item.id !== assetId), inspections: state.inspections.filter((item) => item.assetId !== assetId), alerts: state.alerts.filter((alert) => alert.assetId !== assetId), activity: [activity("Record deleted", record.assetRef, actor, timestamp), ...state.activity] }, timestamp);
}

export function escapeCsvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toExceptionCsv(errors: ImportError[]): string {
  const lines = ["row,field,message", ...errors.map((error) => [error.row, error.field ?? "", error.message].map(escapeCsvCell).join(","))];
  return `${lines.join("\n")}\n`;
}

export function recordToRawRow(record: AssetRecord): Record<RegisterHeader, string | number> {
  return {
    asset_ref: record.assetRef, record_type: record.recordType, asset_type: record.assetType, site: record.site, owner: record.owner,
    serial_no: record.serialNo ?? "", assigned_engineer: record.assignedEngineer ?? "", inspection_due_date: record.inspectionDueDate ?? "",
    inspection_interval_months: record.inspectionIntervalMonths ?? "", licence_expiry_date: record.licenceExpiryDate ?? "", certificate_no: record.certificateNo ?? "",
    certificate_issued_date: record.certificateIssuedDate ?? "", certificate_expiry_date: record.certificateExpiryDate ?? "", retirement_due_date: record.retirementDueDate ?? "", status: record.status,
  };
}
