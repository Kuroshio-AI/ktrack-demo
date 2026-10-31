import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ShieldAlert, ShieldCheck, ShieldMinus, ShieldX } from "lucide-react";
import { VerifyReport } from "@/components/verify-report";
import { AMS_NAME, IS_AMS, IS_TRIAL } from "@/lib/client";
import { effectiveCertificateStatus, todayString } from "@/lib/domain";
import { verifyLiveToken } from "@/lib/tokens";
import type { AssetRecord, Certificate, CertificateStatus, Inspection } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS = {
  Valid: { icon: ShieldCheck, badge: "bg-success", band: "bg-success/[.07]", title: "Valid certificate", detail: "This certificate is current." },
  Expired: { icon: ShieldAlert, badge: "bg-warning", band: "bg-[#fff8e8]", title: "Certificate expired", detail: "This certificate is past its expiry date. Do not rely on it." },
  Revoked: { icon: ShieldX, badge: "bg-danger", band: "bg-[#fff5f5]", title: "Certificate revoked", detail: "This certificate has been withdrawn. Do not rely on it." },
  Superseded: { icon: ShieldMinus, badge: "bg-warning", band: "bg-[#fff8e8]", title: "Certificate superseded", detail: "A newer certificate replaces this one." },
} satisfies Record<CertificateStatus, unknown>;

// AMS issues inspection reports, not certificates.
const REPORT: Partial<Record<CertificateStatus, { title: string; detail: string }>> = {
  Valid: { title: "Valid inspection report", detail: "This report is current." },
  Expired: { title: "Report expired", detail: "This report is past its validity date. Do not rely on it." },
  Revoked: { title: "Report withdrawn", detail: "This report has been withdrawn. Do not rely on it." },
  Superseded: { title: "Report replaced", detail: "A newer report replaces this one." },
};

const WARRANTY: Partial<Record<CertificateStatus, { title: string; detail: string }>> = {
  Valid: { title: "Valid warranty", detail: "This product warranty is in force." },
  Expired: { title: "Warranty expired", detail: "The warranty period has ended." },
  Revoked: { title: "Warranty revoked", detail: "This warranty has been withdrawn. Do not rely on it." },
};

type Report = { inspection: Inspection; record: Pick<AssetRecord, "owner" | "assetRef" | "site">; certificate: Pick<Certificate, "number" | "issuedDate"> };

// The trial reads the report from its records, so a QR printed before a withdrawal, replacement or expiry shows it, and
// whoever scans it sees the report itself. The token only names the report; everything shown comes from the records.
async function trialReport(number: string) {
  const row = await getCloudflareContext().env.DB.prepare("SELECT item.data AS record, certificate.value AS certificate, sheet.data AS inspection FROM item, json_each(item.data, '$.certificates') AS certificate LEFT JOIN item AS sheet ON sheet.kind = 'inspection' AND sheet.id = json_extract(certificate.value, '$.sourceInspectionId') AND sheet.data IS NOT NULL WHERE item.kind = 'record' AND item.data IS NOT NULL AND json_extract(certificate.value, '$.number') = ?")
    .bind(number).first<{ record: string; certificate: string; inspection: string | null }>();
  if (!row) return undefined;
  const record = JSON.parse(row.record) as AssetRecord;
  const certificate = JSON.parse(row.certificate) as Certificate;
  const sheet = row.inspection ? JSON.parse(row.inspection) as Inspection : undefined;
  // The reviewer's notes on a returned sheet stay inside AMS.
  const report: Report | undefined = sheet?.joints ? { inspection: { ...sheet, reviewerComment: undefined }, record: { owner: record.owner, assetRef: record.assetRef, site: record.site }, certificate: { number: certificate.number, issuedDate: certificate.issuedDate } } : undefined;
  return { snapshot: { assetRef: record.assetRef, assetType: record.assetType, issuedDate: certificate.issuedDate, expiryDate: certificate.expiryDate, status: effectiveCertificateStatus(certificate, todayString()) }, report };
}

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  const signed = typeof token === "string" ? token : undefined;
  let result = signed ? await verifyLiveToken(signed, process.env.DEMO_CERT_TOKEN_SECRET ?? "") : { ok: false as const, error: "No token supplied" };
  let report: Report | undefined;
  if (IS_TRIAL && result.ok) {
    const found = await trialReport(result.snapshot.certificateNo);
    report = found?.report;
    result = found ? { ok: true, snapshot: { ...result.snapshot, ...found.snapshot }, checkedAt: new Date().toISOString() } : { ok: false, error: `${AMS_NAME} has no report with this number. Do not rely on it.` };
  }
  const checked = result.ok ? result.checkedAt ?? result.snapshot.asOf : "";
  const warranty = result.ok && result.snapshot.kind === "warranty";
  const tone = result.ok ? { ...STATUS[result.snapshot.status], ...(warranty ? WARRANTY[result.snapshot.status] : IS_AMS ? REPORT[result.snapshot.status] : {}) } : { icon: ShieldX, badge: "bg-danger", band: "bg-[#fff5f5]", title: "Cannot verify", detail: result.error };
  const Icon = tone.icon;
  return <main className="min-h-screen bg-[#f3f7f9] px-4 py-10 sm:py-14">
    <div className="animate-rise mx-auto max-w-md overflow-hidden rounded-2xl border border-[#d4e1e8] bg-white shadow-panel">
      <div className={`px-6 pb-8 pt-7 text-center ${tone.band}`}>
        <div className="text-[11px] font-bold uppercase tracking-[.18em] text-[#1684ab]">{IS_AMS ? AMS_NAME : "Kee Safety"} · KTrack</div>
        <span className={`pop-in mx-auto mt-7 grid size-24 place-items-center rounded-full text-white shadow-lg ring-8 ring-white ${tone.badge}`}><Icon className="size-12" aria-hidden="true" /></span>
        <h1 className="mt-5 text-3xl font-bold tracking-[-.03em] text-[#0b3151]">{tone.title}</h1>
        <p className="mt-2 text-sm text-slate-600">{tone.detail}</p>
      </div>
      {result.ok && <div className="px-6 py-6">
        <div className="text-xs font-bold uppercase tracking-[.1em] text-slate-500">{warranty ? "Warranty number" : IS_AMS ? "Report number" : "Certificate number"}</div>
        <div className="mt-1 break-all font-mono text-xl font-bold text-[#0b3151]">{result.snapshot.certificateNo}</div>
        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-[#e1e9ee] pt-5">
          <div className="col-span-2"><dt className="text-xs font-bold uppercase tracking-[.1em] text-slate-500">{IS_AMS ? "Job" : "Asset"}</dt><dd className="mt-1 font-semibold text-[#0b3151]">{result.snapshot.assetRef} · {result.snapshot.assetType}</dd></div>
          <div><dt className="text-xs font-bold uppercase tracking-[.1em] text-slate-500">{warranty ? "Warranty date" : "Issued"}</dt><dd className="mt-1 font-semibold text-[#0b3151]">{formatDate(result.snapshot.issuedDate)}</dd></div>
          <div><dt className="text-xs font-bold uppercase tracking-[.1em] text-slate-500">{warranty || IS_AMS ? "Valid until" : "Expires"}</dt><dd className="mt-1 font-semibold text-[#0b3151]">{formatDate(result.snapshot.expiryDate)}</dd></div>
        </dl>
        {/* Rendered on the server, so the time is stated in UTC rather than guessing the viewer's zone. */}
        <p className="mt-6 border-t border-[#e1e9ee] pt-4 text-xs leading-relaxed text-slate-500">{IS_TRIAL ? "Inspection report" : `Demo ${warranty ? "warranty" : IS_AMS ? "report" : "certificate"}`} · {result.checkedAt ? "live status checked" : "status as of"} {formatDate(checked.slice(0, 10))}, {checked.slice(11, 16)} UTC.{!result.checkedAt && " This is a signed snapshot, not live certification."}</p>
      </div>}
    </div>
    {/* The report is laid out like the paper form, so on a phone it scrolls sideways inside its frame. */}
    {result.ok && report && <section aria-labelledby="report-heading" className="animate-rise mx-auto mt-8 max-w-[1040px]">
      <h2 id="report-heading" className="text-center text-xs font-bold uppercase tracking-[.1em] text-slate-500">The report</h2>
      <div role="region" aria-labelledby="report-heading" tabIndex={0} className="mt-3 overflow-x-auto rounded-2xl border border-[#d4e1e8] bg-white p-4 shadow-panel sm:p-6">
        <div className="min-w-[880px]"><VerifyReport inspection={report.inspection} record={report.record} certificate={report.certificate} equipment={report.inspection.job?.equipment ?? []} photoToken={signed} /></div>
      </div>
    </section>}
  </main>;
}
