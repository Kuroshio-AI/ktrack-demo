import { addDays, quarterOf, quarterRange, type SavingInput } from "./domain";
import { IS_SAFEEN } from "./client";
import { subseaRows } from "./safeen-sample";
import { REGISTER_HEADERS, type RegisterRow } from "./types";

export type SampleId = "1" | "2";

export function sampleRows(demoDate: string, sample: SampleId = "1"): RegisterRow[] {
  if (IS_SAFEEN) return subseaRows(demoDate, sample);
  if (sample === "2") return [
    { assetRef: "RAS-201", recordType: "equipment", assetType: "Rope Access System", site: "Riverside Depot", owner: "Nora Iyer", serialNo: "RAS-201-RD", assignedEngineer: "Dev Shah", inspectionDueDate: demoDate, inspectionIntervalMonths: 12, certificateNo: "CERT-DEMO-0201", certificateIssuedDate: addDays(demoDate, -365), certificateExpiryDate: addDays(demoDate, -1), retirementDueDate: addDays(demoDate, 30), status: "Active" },
    { assetRef: "LIC-202", recordType: "licence", assetType: "Work-at-Height Licence", site: "Riverside Depot", owner: "Amal Joseph", assignedEngineer: "Leah Wong", licenceExpiryDate: addDays(demoDate, 7), status: "Active" },
    { assetRef: "HAR-203", recordType: "equipment", assetType: "Full Body Harness", site: "Riverside Depot", owner: "Tara Menon", serialNo: "FBH-203-26", assignedEngineer: "Dev Shah", inspectionDueDate: addDays(demoDate, 90), inspectionIntervalMonths: 6, retirementDueDate: demoDate, status: "Active" },
    { assetRef: "SRL-204", recordType: "equipment", assetType: "Self-Retracting Lifeline", site: "Riverside Depot", owner: "Kiran Bose", serialNo: "SRL-204-25", assignedEngineer: "Leah Wong", inspectionDueDate: addDays(demoDate, 30), inspectionIntervalMonths: 6, certificateNo: "CERT-DEMO-0204", certificateIssuedDate: addDays(demoDate, -180), certificateExpiryDate: addDays(demoDate, 7), status: "Active" },
    { assetRef: "KIT-205", recordType: "equipment", assetType: "Rescue Kit", site: "Riverside Depot", owner: "Mira Das", serialNo: "RKT-205-26", assignedEngineer: "Dev Shah", inspectionDueDate: addDays(demoDate, 90), inspectionIntervalMonths: 12, certificateNo: "CERT-DEMO-0205", certificateIssuedDate: addDays(demoDate, -180), certificateExpiryDate: addDays(demoDate, 180), status: "Active" },
    { assetRef: "LIF-206", recordType: "equipment", assetType: "Horizontal Lifeline", site: "Riverside Depot", owner: "Omar Khan", serialNo: "HLL-206-23", assignedEngineer: "Leah Wong", inspectionDueDate: addDays(demoDate, -14), inspectionIntervalMonths: 6, retirementDueDate: addDays(demoDate, -7), status: "Retired" },
  ];
  return [
    { assetRef: "HAR-001", recordType: "equipment", assetType: "Full Body Harness", site: "Northpoint Works", owner: "Maya Singh", serialNo: "FBH-001-26", assignedEngineer: "Leo Hart", inspectionDueDate: addDays(demoDate, 7), inspectionIntervalMonths: 6, status: "Active" },
    { assetRef: "LIF-014", recordType: "equipment", assetType: "Horizontal Lifeline", site: "Northpoint Works", owner: "Rory Chen", serialNo: "HLL-014-24", assignedEngineer: "Leo Hart", inspectionDueDate: addDays(demoDate, -3), inspectionIntervalMonths: 6, status: "Active" },
    { assetRef: "LIC-023", recordType: "licence", assetType: "Work-at-Height Licence", site: "Harbour Plant", owner: "Aisha Khan", assignedEngineer: "Priya Das", licenceExpiryDate: addDays(demoDate, 30), status: "Active" },
    { assetRef: "RAS-009", recordType: "equipment", assetType: "Rope Access System", site: "Harbour Plant", owner: "Jon Bell", assignedEngineer: "Priya Das", inspectionDueDate: addDays(demoDate, -1), inspectionIntervalMonths: 12, status: "Active" },
    { assetRef: "CERT-018", recordType: "equipment", assetType: "Roof Access Kit", site: "East Yard", owner: "Maya Singh", certificateNo: "CERT-2026-0018", certificateIssuedDate: addDays(demoDate, -30), certificateExpiryDate: addDays(demoDate, 335), status: "Active" },
    { assetRef: "HAR-004", recordType: "equipment", assetType: "Full Body Harness", site: "Northpoint Works", owner: "Rory Chen", serialNo: "FBH-004-22", status: "Retired" },
  ];
}

// Fictional savings on the sample sites, all in the demo date's quarter: a few days back, but never before the quarter starts.
export function sampleSavings(demoDate: string, sample: SampleId = "1"): SavingInput[] {
  // The SAFEEN build has no Sustainability page, so its samples carry no savings.
  if (IS_SAFEEN) return [];
  const [quarterStart] = quarterRange(quarterOf(demoDate));
  const daysBack = (days: number) => { const date = addDays(demoDate, -days); return date < quarterStart ? quarterStart : date; };
  if (sample === "2") return [
    { type: "pallets", date: daysBack(2), quantity: 24, unit: "pallets", factor: 2.1752, description: "Damaged pallets repaired and reused", site: "Riverside Depot", costSaving: 216 },
    { type: "deliveries", date: daysBack(6), quantity: 860, unit: "km avoided", factor: 0.6337, description: "Weekly Riverside runs combined into one", site: "Riverside Depot" },
    { type: "other", date: daysBack(11), quantity: 300, unit: "kg", factor: 1.5, description: "Steel offcuts sent for recycling", site: "Riverside Depot", evidence: "Demo scrap note SN-0311" },
  ];
  return [
    { type: "paper", date: daysBack(1), quantity: 420, unit: "kg", factor: 0.94, description: "Archived job files shredded and recycled", site: "Northpoint Works", evidence: "Demo recycler note DRN-1042" },
    { type: "pallets", date: daysBack(4), quantity: 18, unit: "pallets", factor: 2.1752, description: "Damaged pallets repaired and reused", site: "Harbour Plant", costSaving: 162 },
    { type: "deliveries", date: daysBack(9), quantity: 1250, unit: "km avoided", factor: 0.6337, description: "Two East Yard deliveries merged into one", site: "East Yard" },
  ];
}

export function rowsToMatrix(rows: RegisterRow[]): (string | number)[][] {
  return rows.map((row) => [row.assetRef, row.recordType, row.assetType, row.site, row.owner, row.serialNo ?? "", row.assignedEngineer ?? "", row.inspectionDueDate ?? "", row.inspectionIntervalMonths ?? "", row.licenceExpiryDate ?? "", row.certificateNo ?? "", row.certificateIssuedDate ?? "", row.certificateExpiryDate ?? "", row.retirementDueDate ?? "", row.status]);
}

export function rowToRaw(row: RegisterRow): Record<string, string | number> {
  return {
    asset_ref: row.assetRef, record_type: row.recordType, asset_type: row.assetType, site: row.site, owner: row.owner,
    serial_no: row.serialNo ?? "", assigned_engineer: row.assignedEngineer ?? "", inspection_due_date: row.inspectionDueDate ?? "",
    inspection_interval_months: row.inspectionIntervalMonths ?? "", licence_expiry_date: row.licenceExpiryDate ?? "", certificate_no: row.certificateNo ?? "",
    certificate_issued_date: row.certificateIssuedDate ?? "", certificate_expiry_date: row.certificateExpiryDate ?? "", retirement_due_date: row.retirementDueDate ?? "", status: row.status,
  };
}

export const sampleHeaders = [...REGISTER_HEADERS];
