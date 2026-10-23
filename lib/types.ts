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
  // FLS only: the certificate's issue date and the sheet's Remarks column.
  licenceIssuedDate?: string;
  remarks?: string;
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

export type AssetRecord = RegisterRow & {
  id: string;
  warranty?: Warranty;
  certificates: Certificate[];
  activity: Activity[];
  createdAt: string;
  updatedAt: string;
};

export type ChecklistItem = {
  id: string;
  label: string;
  // FLS PPM checklists group their items under the paper form's headings (Inspection, Testing, Maintenance).
  section?: string;
  result: "pass" | "fail" | "na" | "pending";
};

export type InspectionPhoto = {
  id: string;
  name: string;
  type: string;
  dataUrl: string;
  bytes: number;
};

// AMS only: one row of a dimension table, the acceptance limits for one size, weight, connection and grade. All values in inches.
export type Limit = { column: string; min?: number; max?: number };
export type ConnectionSpec = {
  id: string;
  size: string;
  weight: string;
  connection: string;
  grade: string;
  limits: Limit[];
  // Made-up rows that ship with the public demo; the client's own table is imported.
  sample?: boolean;
};

// AMS only: one line of the F.582 drill pipe tally sheet, one pipe. Numbers are keyed by tally column, in inches
// (length in feet); condition codes are keyed the same way, and a missing code means OK.
export type FinalClass = "Class 1 (New)" | "Class 1-Rework" | "Premium-Accepted" | "Premium-Rework" | "Class-2" | "Bent" | "Scrap";
export type Joint = {
  no: number;
  serial?: string;
  values: Record<string, number>;
  codes: Record<string, string>;
  // ID coating condition 1 to 4, from the form's reference scale.
  coating?: number;
  // The inspector's call; unset takes KTrack's suggestion.
  finalClass?: FinalClass;
};

// AMS only: an inspection instrument from the F.581 equipment details.
export type Equipment = { id: string; kind: string; model: string; serial: string; calibrationDue: string };

// AMS only: the F.581 and F.582 header fields that aren't on the job record (customer, rig and work order are).
export type TallyJob = {
  well: string;
  location: string;
  range: string;
  nominalWall: number;
  standard: string;
  serviceCategory: string;
  toolJointOd?: string;
  pinId?: string;
  hardBand?: string;
  program: string[];
  services: string[];
  equipmentIds: string[];
  // Copied on submission, so an issued report keeps the calibration dates it was checked against.
  equipment?: Equipment[];
};

export type Inspection = {
  id: string;
  assetId: string;
  inspector: string;
  // FLS only: which system's PPM checklist this is, such as "Fire alarm system".
  title?: string;
  checklist: ChecklistItem[];
  // AMS only: a tally sheet keeps its own copy of the connection's limits, so a later import never regrades an issued report.
  connection?: ConnectionSpec;
  job?: TallyJob;
  joints?: Joint[];
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
  // AMS only: the dimension table that new tally sheets are checked against.
  connections?: ConnectionSpec[];
  // AMS only: the inspection instruments and their calibration due dates.
  equipment?: Equipment[];
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
  // FLS only: rows for buildings already in KTrack whose sheet values changed.
  updates?: RegisterRow[];
};
