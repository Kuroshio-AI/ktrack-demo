// No "use client": only client views render it, and it takes a callback.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Signature } from "@/components/warranty-document";
import { AMS_NAME } from "@/lib/client";
import { connectionLabel, failureText, gradeJoint, inches, limitFailure, limitText, summarizeTally, VISUAL } from "@/lib/tally";
import type { AssetRecord, Certificate, Inspection } from "@/lib/types";
import { formatDate, formatLocalDate } from "@/lib/utils";

// The summary report a tally sheet produces: the job, the totals and why joints were rejected, then the tally itself as the evidence.
// Their own report layout replaces this one once we have it; the numbers all come from the tally, nothing is typed twice.
export function TallyReport({ inspection, record, certificate, qr }: { inspection: Inspection; record: AssetRecord; certificate?: Certificate; qr?: string }) {
  const spec = inspection.connection;
  const joints = inspection.joints ?? [];
  if (!spec) return null;
  const summary = summarizeTally(spec, joints);
  const facts: [string, string][] = [["Job", record.assetRef], ["Customer", record.owner], ["Rig", record.site], ["Connection", connectionLabel(spec)], ["Inspector", inspection.inspector], ["Acceptance criteria", spec.sample ? "Sample table, not DS-1 values" : "DS-1 used tool joint table"]];
  return <div className="border-[8px] border-[#0b3151] p-1 text-[11.5px] leading-[1.5] text-ink"><div className="border border-[#b8cedc] px-6 py-6 sm:px-8">
    <div className="flex items-start justify-between gap-6">
      <div><div className="text-xs font-bold uppercase tracking-[.2em] text-accent">{AMS_NAME} · KTrack</div><h2 className="mt-1 text-2xl font-black leading-tight tracking-tight text-navy">Used tool joint dimensional inspection report</h2><div className="mt-1 text-slate-500">Summary generated from the tally sheet</div></div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">{certificate ? <><div className="eyebrow">Report number</div><div className="font-mono text-base font-bold text-navy">{certificate.number}</div></> : <Badge variant="warning">Draft · not issued</Badge>}<Badge variant="warning">Demo</Badge></div>
    </div>
    <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-2 rounded-lg bg-paper px-4 py-3 sm:grid-cols-3">{facts.map(([label, value]) => <div key={label}><dt className="eyebrow">{label}</dt><dd className="mt-0.5 font-semibold text-navy">{value}</dd></div>)}{certificate && <><div><dt className="eyebrow">Issued</dt><dd className="mt-0.5 font-semibold text-navy">{formatDate(certificate.issuedDate)}</dd></div><div><dt className="eyebrow">Valid until</dt><dd className="mt-0.5 font-semibold text-navy">{formatDate(certificate.expiryDate)}</dd></div></>}</dl>

    <div className="mt-5 grid grid-cols-3 gap-3 break-inside-avoid">{([["Joints inspected", summary.total, "text-navy"], ["Premium", summary.premium, "text-success"], ["Reject", summary.reject, summary.reject ? "text-danger" : "text-navy"]] as const).map(([label, value, tone]) => <div key={label} className="rounded-lg border border-line px-4 py-2.5"><div className="eyebrow">{label}</div><div className={`mt-0.5 text-2xl font-black tabular-nums ${tone}`}>{value}</div></div>)}</div>
    {summary.pending > 0 && <p className="mt-2 text-xs font-semibold text-[#8a5d00]">{summary.pending} joint{summary.pending === 1 ? " is" : "s are"} not fully measured yet.</p>}

    {summary.reject > 0 && <div className="mt-5 grid gap-5 break-inside-avoid sm:grid-cols-[.8fr_1.2fr]">
      <div><div className="eyebrow">Reject reasons</div><table className="mt-1.5 w-full border-collapse"><tbody>{summary.reasons.map((reason) => <tr key={reason.column} className="border-b border-line"><td className="py-1">{reason.column === VISUAL ? "Visual (threads, shoulders, damage)" : reason.column}</td><td className="py-1 text-right font-mono font-bold text-danger">{reason.count}</td></tr>)}</tbody></table></div>
      <div><div className="eyebrow">Rejected joints</div><table className="mt-1.5 w-full border-collapse"><tbody>{summary.rejects.map(({ joint, failures }) => <tr key={joint.no} className="border-b border-line align-top"><td className="w-10 py-1 font-mono text-slate-500">{joint.no}</td><td className="w-20 py-1 font-mono">{joint.serial ?? ""}</td><td className="py-1 text-danger">{[...failures.map(failureText), ...(joint.visual === "fail" ? ["Visual check failed"] : [])].join("; ")}</td></tr>)}</tbody></table></div>
    </div>}

    <div className="mt-6"><div className="eyebrow">Tally sheet</div>
      <table className="mt-1.5 w-full border-collapse text-[9.5px]">
        <thead><tr className="border-b-2 border-[#0b3151] text-left align-bottom font-bold text-navy"><th className="py-1 pr-1">Joint</th><th className="py-1 pr-1">Serial</th>{spec.limits.map((limit) => <th key={limit.column} className="py-1 pr-1 text-right">{limit.column}<div className="font-mono font-normal text-slate-500">{limitText(limit)}</div></th>)}<th className="py-1 pr-1">Visual</th><th className="py-1">Grade</th></tr></thead>
        <tbody>{joints.map((joint) => {
          const { grade } = gradeJoint(spec, joint);
          return <tr key={joint.no} className={`break-inside-avoid border-b border-line ${grade === "Reject" ? "bg-[#fff6f6]" : ""}`}><td className="py-0.5 pr-1 font-mono">{joint.no}</td><td className="whitespace-nowrap py-0.5 pr-1 font-mono">{joint.serial ?? ""}</td>{spec.limits.map((limit) => { const value = joint.values[limit.column]; return <td key={limit.column} className={`py-0.5 pr-1 text-right font-mono ${limitFailure(limit, value) ? "font-bold text-danger" : ""}`}>{value === undefined ? "" : inches(value)}</td>; })}<td className={`py-0.5 pr-1 ${joint.visual === "fail" ? "font-bold text-danger" : ""}`}>{joint.visual === "pending" ? "" : joint.visual === "pass" ? "Pass" : "Fail"}</td><td className={`py-0.5 font-bold ${grade === "Reject" ? "text-danger" : grade === "Premium" ? "text-success" : "text-slate-400"}`}>{grade === "Pending" ? "" : grade}</td></tr>;
        })}</tbody>
      </table>
    </div>
    {inspection.notes.trim() && <div className="mt-5 break-inside-avoid"><div className="eyebrow">Comments</div><p className="mt-1 whitespace-pre-wrap rounded-lg border border-line px-3 py-2">{inspection.notes}</p></div>}
    <div className="mt-6 flex break-inside-avoid flex-col gap-6 sm:flex-row sm:items-end">
      {qr && <div className="shrink-0 text-center"><img src={qr} alt="Report verification QR" className="mx-auto size-28" /><div className="eyebrow mt-1">Scan to verify</div></div>}
      <div className="grid flex-1 grid-cols-2 gap-8"><Signature label="Inspected by" name={inspection.inspector} date={inspection.submittedAt} image={inspection.signature} /><Signature label="Approved by" name={certificate ? "Authorised reviewer" : "Awaiting approval"} date={certificate ? inspection.reviewedAt : undefined} /></div>
    </div>
    <footer className="mt-6 border-t border-line pt-2 text-[10px] text-slate-500">KTrack demo report · fictional jobs{spec.sample ? " and sample limits" : ""} · generated {inspection.submittedAt ? formatLocalDate(inspection.submittedAt) : "from the draft"}. The summary is worked out from the tally; nothing is retyped.</footer>
  </div></div>;
}

// Print preview for one tally sheet's report; Print / Save PDF prints only this dialog (see .certificate-print-area in globals.css).
export function TallyReportDialog({ inspectionId, qr, onClose }: { inspectionId: string; qr?: string; onClose: () => void }) {
  const { state } = useApp();
  const dialog = useRef<HTMLDialogElement>(null);
  const inspection = state.inspections.find((item) => item.id === inspectionId);
  const record = state.records.find((item) => item.id === inspection?.assetId);
  const certificate = record?.certificates.find((item) => item.id === inspection?.certificateId);
  useEffect(() => { dialog.current?.showModal(); }, []);
  if (!inspection || !record) return null;
  return createPortal(<dialog ref={dialog} aria-label={`${record.assetRef} inspection report`} onClose={onClose} className="certificate-print-area animate-rise fixed inset-0 m-auto max-h-[95vh] w-[min(95vw,980px)] overflow-auto bg-white p-5 backdrop:bg-black/50 sm:p-10">
    <div className="print-hidden mb-5 flex justify-end gap-2"><Button onClick={() => window.print()}><Printer data-icon="inline-start" />Print / Save PDF</Button><Button variant="outline" onClick={() => dialog.current?.close()}>Close</Button></div>
    <TallyReport inspection={inspection} record={record} certificate={certificate} qr={qr} />
  </dialog>, document.body);
}
