import type { Survey } from "./survey";
export const REGISTER_HEADERS = [
  "asset_ref",
  "record_type",
  "asset_type",
  "site",
  "owner",
  "serial_no",
  "assigned_engineer",
  "inspection_due_date",
  "inspection_interval_months",
  "licence_expiry_date",
  "certificate_no",
  "certificate_issued_date",
  "certificate_expiry_date",
  "retirement_due_date",
  "status",
] as const;

export type RegisterHeader = (typeof REGISTER_HEADERS)[number];

// The Sustainability export's columns; the Import tab reads the same layout back.
export const SAVING_HEADERS = ["certificate_no", "quarter", "date", "type", "description", "quantity", "unit", "kg_co2e_per_unit", "kg_co2e_saved", "cost_saving_usd", "site", "evidence", "issued_date"] as const;
export type SavingHeader = (typeof SAVING_HEADERS)[number];
export type RecordType = "equipment" | "licence";
export type AssetStatus = "Active" | "Retired";
export type Role = "Admin" | "Engineer" | "Reviewer" | "Manager";
export type InspectionStatus = "Draft" | "Submitted" | "Returned" | "Approved" | "Issued";
export type CertificateStatus = "Valid" | "Expired" | "Revoked" | "Superseded";
export type AlertStatus = "open" | "resolved" | "history";
export type AlertSeverity = "info" | "warning" | "critical";
export type DeadlineTier = "due30" | "due7" | "today" | "overdue";

export type RegisterRow = {
  assetRef: string;
  recordType: RecordType;
  assetType: string;
  site: string;
  owner: string;
  serialNo?: string;
  assignedEngineer?: string;
  inspectionDueDate?: string;
  inspectionIntervalMonths?: number;
  licenceExpiryDate?: string;
  certificateNo?: string;
  certificateIssuedDate?: string;
  certificateExpiryDate?: string;
  retirementDueDate?: string;
  status: AssetStatus;
};

export type Certificate = {
  id: string;
  number: string;
  issuedDate: string;
  expiryDate: string;
  result: "Pass" | "Fail";
  status: CertificateStatus;
  sourceInspectionId?: string;
  token?: string;
  verifyUrl?: string;
  tokenIssuedAt?: string;
};

// Typed in from the original warranty document; replaces the one derived from the first certificate.
export type Warranty = {
  number: string;
  product: string;
  warrantyDate: string;
  years: number;
  contractNo?: string;
  project?: string;
  scope?: string;
  mainContractor?: string;
  // Demo date it was revoked; a revoked warranty is kept for the record and can't be edited.
  revokedDate?: string;
};

export type SavingType = "paper" | "pallets" | "deliveries" | "other";

// An environmental saving typed in from Kee Safety's own tracking. CO₂e is always quantity × factor, never stored.
export type Saving = {
  id: string;
  // ENV-2026-001; never reused after a removal.
  number: string;
  type: SavingType;
  // Activity date; its quarter groups the totals.
  date: string;
  quantity: number;
  unit: string;
  // kg CO₂e per unit.
  factor: number;
  description?: string;
  site?: string;
  evidence?: string;
  costSaving?: number;
  // Demo date it was first saved; printed as the certificate date.
  issuedDate: string;
  createdAt: string;
  updatedAt: string;
};

// Set when a reviewer takes failed equipment out of service; only a passing, issued inspection clears it.
// inspectionId is set when a failed inspection raised the tag; a tag put on from the deck has none.
export type RedTag = { date: string; reason: string; inspectionId?: string };

export type AssetRecord = RegisterRow & {
  id: string;
  warranty?: Warranty;
  redTag?: RedTag;
  certificates: Certificate[];
  activity: Activity[];
  createdAt: string;
  updatedAt: string;
};

export type ChecklistItem = {
  id: string;
  label: string;
  result: "pass" | "fail" | "na" | "pending";
};

export type InspectionPhoto = {
  id: string;
  name: string;
  type: string;
  dataUrl: string;
  bytes: number;
};

export type Inspection = {
  id: string;
  assetId: string;
  inspector: string;
  checklist: ChecklistItem[];
  photos?: InspectionPhoto[];
  // PNG drawn on the phone hand-off page; shown on the certificate's "Inspected by" line.
  signature?: string;
  notes: string;
  status: InspectionStatus;
  reviewerComment?: string;
  submittedAt?: string;
  reviewedAt?: string;
  certificateId?: string;
  nextInspectionDate?: string;
  createdAt: string;
  updatedAt: string;
};

export type Alert = {
  id: string;
  occurrenceKey: string;
  type: "deadline" | "review" | "certificate" | "system";
  event: string;
  assetId?: string;
  assetRef?: string;
  owner?: string;
  dueDate?: string;
  timestamp: string;
  severity: AlertSeverity;
  tier?: DeadlineTier;
  status: AlertStatus;
  acknowledgedBy?: Role;
  acknowledgedAt?: string;
  emailSentAt?: string;
  whatsappSentAt?: string;
};

export type Activity = {
  id: string;
  event: string;
  detail: string;
  actor: Role | "system";
  timestamp: string;
};

export type AppState = {
  version: 1;
  demoDate: string;
  role: Role;
  records: AssetRecord[];
  inspections: Inspection[];
  alerts: Alert[];
  activity: Activity[];
  // Optional so workspaces and backups saved before Sustainability stay valid.
  savings?: Saving[];
  // Last saving number issued per year, so a removed saving's certificate number is never handed out again.
  savingCounters?: Record<string, number>;
  // SAFEEN pipeline and riser survey tallies; optional so older workspaces stay valid.
  surveys?: Survey[];
};

export type ImportError = {
  row: number;
  field?: string;
  message: string;
  raw?: Record<string, unknown>;
};

export type ImportPreview = {
  totalRows: number;
  validRows: RegisterRow[];
  errors: ImportError[];
  duplicates: ImportError[];
};
