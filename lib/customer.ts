import { effectiveCertificateStatus } from "./domain";
import { customerKey } from "./sync";
import { FINAL_CLASSES, summarizeTally } from "./tally";
import type { AppState, AssetRecord, Certificate, CertificateStatus, FinalClass, Inspection } from "./types";

// A new tally sheet's Customer choices: every customer with a login, then other names earlier jobs used. Each appears
// once, matched the way the server matches a job to an account, and spelled as on the login.
export function customerChoices(accounts: string[], owners: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const name of [...accounts, ...owners]) {
    const key = customerKey(name);
    if (key && !byKey.has(key)) byKey.set(key, name.trim().replace(/\s+/g, " "));
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

// The customer portal's numbers: one shipment per tally sheet, from the same grading as the F.581. Classes count only once
// the report is issued, since a sheet still being measured or reviewed can change.
export type Shipment = {
  record: AssetRecord;
  inspection: Inspection;
  certificate?: Certificate;
  status?: CertificateStatus;
  // The report's issue date, or the day the sheet was opened while it is still in inspection.
  date: string;
  total: number;
  measured: number;
  classes: Record<FinalClass, number>;
};

const none = () => Object.fromEntries(FINAL_CLASSES.map((cls) => [cls, 0])) as Record<FinalClass, number>;

export function customerShipments(state: AppState): Shipment[] {
  return state.inspections.flatMap((inspection): Shipment[] => {
    const record = state.records.find((item) => item.id === inspection.assetId);
    if (!record || !inspection.connection || !inspection.job || !inspection.joints) return [];
    const certificate = record.certificates.find((item) => item.id === inspection.certificateId);
    const summary = summarizeTally(inspection.connection, inspection.job, inspection.joints);
    const classes = none();
    if (certificate) for (const row of summary.rows) if (row.label in classes) classes[row.label as FinalClass] = row.count;
    return [{ record, inspection, certificate, status: certificate && effectiveCertificateStatus(certificate, state.demoDate), date: certificate?.issuedDate ?? inspection.createdAt.slice(0, 10), total: summary.total, measured: summary.total - summary.pending, classes }];
  }).sort((a, b) => b.date.localeCompare(a.date));
}

// Totals over reports that still stand: a revoked or superseded report no longer counts.
export function shipmentTotals(shipments: Shipment[]) {
  const counted = shipments.filter((item) => item.status === "Valid" || item.status === "Expired");
  const classes = none();
  for (const item of counted) for (const cls of FINAL_CLASSES) classes[cls] += item.classes[cls];
  const pipes = counted.reduce((sum, item) => sum + item.total, 0);
  return { shipments: counted.length, pipes, classes, premium: classes["Premium-Accepted"] + classes["Class 1 (New)"] };
}
