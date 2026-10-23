"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import Link from "next/link";
import { ArrowRight, Building2, CheckCircle2, FileText, MessageSquareReply, ShieldCheck, X } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { ChecklistReportDialog } from "@/components/checklist-report";
import { ChecklistSections } from "@/components/checklist-sections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TallyReportDialog } from "@/components/tally-report";
import { IS_AMS, IS_FLS, RESULT_LABELS } from "@/lib/client";
import { addMonthsClamped, approveChecklist, approveInspection, returnInspection } from "@/lib/domain";
import { failureText, summarizeTally } from "@/lib/tally";
import type { ChecklistItem, Inspection, InspectionPhoto } from "@/lib/types";
import { formatDate } from "@/lib/utils";

// The PPM checklist at a glance: how many items came back Ok, Not Ok and N/A.
function ResultCounts({ checklist }: { checklist: ChecklistItem[] }) {
  return <dl className="grid grid-cols-3 gap-2">{(["pass", "fail", "na"] as const).map((result) => {
    const count = checklist.filter((item) => item.result === result).length;
    return <div key={result} className={`rounded-lg border px-3 py-2 ${result === "fail" && count ? "border-[#f0c2c3] bg-[#fff6f6] text-danger" : "border-line text-navy"}`}><dt className="eyebrow">{RESULT_LABELS[result]}</dt><dd className="mt-0.5 text-xl font-bold tabular-nums">{count}</dd></div>;
  })}</dl>;
}

// AMS: what a reviewer checks before issuing, the tally's totals and every rejected joint with its reason.
function TallyReview({ inspection, onReport }: { inspection: Inspection; onReport: () => void }) {
  const summary = summarizeTally(inspection.connection!, inspection.joints ?? []);
  return <div className="flex flex-col gap-3">
    <dl className="grid grid-cols-3 gap-2">{([["Joints", summary.total, "text-navy"], ["Premium", summary.premium, "text-success"], ["Reject", summary.reject, summary.reject ? "text-danger" : "text-navy"]] as const).map(([label, value, tone]) => <div key={label} className="rounded-lg border border-line px-3 py-2"><dt className="eyebrow">{label}</dt><dd className={`mt-0.5 text-xl font-bold tabular-nums ${tone}`}>{value}</dd></div>)}</dl>
    {summary.rejects.length > 0 && <div className="rounded-lg border border-[#f0c2c3] bg-[#fff6f6] px-3 py-2 text-sm"><div className="eyebrow !text-danger">Rejected joints</div><ul className="mt-1 flex flex-col gap-0.5 text-danger">{summary.rejects.map(({ joint, failures }) => <li key={joint.no}><span className="font-mono font-semibold">Joint {joint.no}{joint.serial && ` · ${joint.serial}`}</span>: {[...failures.map(failureText), ...(joint.visual === "fail" ? ["visual check failed"] : [])].join("; ")}</li>)}</ul></div>}
    <Button variant="outline" size="sm" className="self-start" onClick={onReport}><FileText data-icon="inline-start" />View the summary report</Button>
  </div>;
}

export function ApprovalsView() {
  const { state, update } = useApp();
  const [comment, setComment] = useState("");
  // An AMS report is good for six months, like the sample in the brochure; Kee certificates for a year.
  const [expiry, setExpiry] = useState(addMonthsClamped(state.demoDate, IS_AMS ? 6 : 12));
  const [selectedId, setSelectedId] = useState<string>();
  const [message, setMessage] = useState("");
  const queue = state.inspections.filter((inspection) => inspection.status === "Submitted" || inspection.status === "Returned");
  const canReview = state.role === "Admin" || state.role === "Reviewer";
  const selected = queue.find((inspection) => inspection.id === selectedId) ?? queue[0];
  const selectedRecord = state.records.find((record) => record.id === selected?.assetId);
  // Approved work leaves the queue, so keep its receipt on screen until the reviewer moves on.
  const [issuedId, setIssuedId] = useState<string>();
  const [viewing, setViewing] = useState<InspectionPhoto>();
  const [report, setReport] = useState<string>();
  const [tallyReport, setTallyReport] = useState<string>();
  const viewer = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (viewing) viewer.current?.showModal(); }, [viewing]);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const issued = state.inspections.find((inspection) => inspection.id === issuedId);
  const issuedRecord = state.records.find((record) => record.id === issued?.assetId);
  const issuedCertificate = issuedRecord?.certificates.find((certificate) => certificate.id === issued?.certificateId);
  function select(id?: string) { setSelectedId(id); setIssuedId(undefined); setMessage(""); }

  function returnWork() {
    if (!selected || selected.status !== "Submitted" || !comment.trim() || !canReview) { setMessage(selected?.status === "Returned" ? "This inspection is already returned; resubmit it before reviewing again." : "A return needs a mandatory correction comment."); return; }
    if (update((current) => returnInspection(current, selected.id, comment, current.role))) { setComment(""); setMessage("Inspection returned with a correction request."); }
  }
  function approve() {
    if (!selected || selected.status !== "Submitted" || !canReview) { setMessage("Only a submitted inspection can be approved."); return; }
    if (IS_FLS) { flushSync(() => { if (update((current) => approveChecklist(current, selected.id, current.role))) { setIssuedId(selected.id); setMessage(""); } }); receiptHeading.current?.focus(); return; }
    if (selected.checklist.some((item) => item.result === "fail" || item.result === "pending")) { setMessage("This inspection cannot issue: every checklist item must pass or be N/A."); return; }
    if (!expiry || expiry < state.demoDate) { setMessage("Choose an expiry on or after the demo date."); return; }
    flushSync(() => { if (update((current) => approveInspection(current, selected.id, expiry, current.role))) { setIssuedId(selected.id); setMessage(""); } });
    receiptHeading.current?.focus();
  }
  return <div className="grid gap-5 xl:grid-cols-[.82fr_1.18fr]">
    {/* Clicking the dimmed backdrop targets the dialog itself, so it closes like Esc does. */}
    {report && <ChecklistReportDialog inspectionId={report} onClose={() => setReport(undefined)} />}
    {tallyReport && <TallyReportDialog inspectionId={tallyReport} onClose={() => setTallyReport(undefined)} />}
    {viewing && createPortal(<dialog ref={viewer} aria-label={viewing.name} onClose={() => setViewing(undefined)} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }} className="animate-rise fixed inset-0 m-auto max-h-[94vh] max-w-[94vw] overflow-hidden rounded-xl bg-white p-2 backdrop:bg-black/75">
      <img src={viewing.dataUrl} alt={viewing.name} className="max-h-[calc(94vh-4rem)] w-auto rounded-lg object-contain" />
      <div className="flex items-center justify-between gap-3 px-2 pt-2"><span className="truncate text-xs text-slate-500">{viewing.name}</span><Button variant="ghost" size="sm" onClick={() => viewer.current?.close()}><X />Close</Button></div>
    </dialog>, document.body)}
    <Card><CardHeader className="border-b border-line"><div className="eyebrow">Review queue</div><CardTitle>{queue.length} {IS_FLS ? "checklist" : IS_AMS ? "tally sheet" : "inspection"}{queue.length === 1 ? "" : "s"} to review</CardTitle></CardHeader><CardContent className="p-3 sm:p-4">{queue.length ? <div className="flex flex-col gap-1">{queue.map((inspection) => { const record = state.records.find((item) => item.id === inspection.assetId); return <button key={inspection.id} className={`focus-ring flex items-center justify-between gap-3 rounded-lg px-3 py-3 text-left ${!issuedId && selected?.id === inspection.id ? "bg-[#e8f3f8]" : "hover:bg-paper"}`} onClick={() => select(inspection.id)}><div className="min-w-0"><div className="font-semibold text-navy">{record?.assetRef ?? "Unknown asset"}</div><div className="truncate text-xs text-slate-500">{inspection.joints ? `${record?.owner} · ${record?.assetType}` : inspection.title ?? record?.assetType} · {inspection.inspector}</div></div><Badge variant={inspection.status === "Returned" ? "danger" : "warning"}>{inspection.status}</Badge></button>})}</div> : <div className="px-3 py-10 text-center text-sm text-slate-500">The review queue is clear.</div>}</CardContent></Card>
    {IS_FLS && issued && issuedRecord ? <Card className="animate-rise">
      <CardContent className="flex flex-col gap-4 p-5 sm:px-7 sm:py-6">
        <h2 ref={receiptHeading} tabIndex={-1} className="outline-none"><span className="eyebrow flex items-center gap-1.5 !text-success"><CheckCircle2 className="size-3.5" aria-hidden="true" />Checklist approved</span><span className="mt-2 block text-2xl font-bold tracking-tight text-navy">{issued.title ?? "Inspection"}</span></h2>
        <p className="-mt-2 text-sm text-slate-600">{issuedRecord.assetRef} · {issued.inspector}</p>
        <ResultCounts checklist={issued.checklist} />
        <p className="text-xs text-slate-500">Saved to {issuedRecord.assetRef}&apos;s checklists.{issued.checklist.some((item) => item.result === "fail") && " The Not Ok items are in Alerts to follow up with the service provider."}</p>
        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">{queue.length > 0 && <Button variant="ghost" className="mr-auto" onClick={() => select()}>Review next · {queue.length} waiting</Button>}<Button asChild variant="outline"><Link href={`/register?asset=${issuedRecord.id}`}><Building2 data-icon="inline-start" />Open building</Link></Button><Button onClick={() => setReport(issued.id)}><FileText data-icon="inline-start" />View report</Button></div>
      </CardContent>
    </Card> : issuedCertificate && issuedRecord ? <Card className="animate-rise overflow-hidden">
      <div className="flex flex-col-reverse gap-5 border-b border-success/20 bg-success/[.06] px-5 py-6 sm:flex-row sm:items-start sm:justify-between sm:px-7">
        <div className="min-w-0">
          <h2 ref={receiptHeading} tabIndex={-1} className="outline-none"><span className="eyebrow flex items-center gap-1.5 !text-success"><ShieldCheck className="size-3.5" aria-hidden="true" />{issued?.joints ? "Report issued" : "Certificate issued"}</span><span className="mt-2 block break-all font-mono text-2xl font-bold tracking-tight text-navy sm:text-[28px]">{issuedCertificate.number}</span></h2>
          <p className="mt-1 text-sm text-slate-600">{issuedRecord.assetRef} · {issuedRecord.assetType} · {issuedRecord.site}</p>
        </div>
        <div aria-hidden="true" className="stamp flex shrink-0 flex-col items-center self-start rounded-lg border-2 border-success px-4 py-2 text-success outline outline-1 outline-offset-[3px] outline-success/40">
          <span className="text-[9px] font-bold uppercase tracking-[.22em] opacity-80">Quality gate</span>
          <span className="text-xl font-black uppercase leading-tight tracking-[.16em]">Issued</span>
          <span className="font-mono text-[10px] font-semibold">{formatDate(issuedCertificate.issuedDate)}</span>
        </div>
      </div>
      <CardContent className="flex flex-col gap-5 p-5 sm:px-7">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">{(issued?.joints ? (() => { const summary = summarizeTally(issued.connection!, issued.joints); return [["Joints", String(summary.total)], ["Premium · Reject", `${summary.premium} · ${summary.reject}`], ["Valid until", formatDate(issuedCertificate.expiryDate)]]; })() : [["Result", issuedCertificate.result], ["Expires", formatDate(issuedCertificate.expiryDate)], ["Next inspection", issued?.nextInspectionDate ? formatDate(issued.nextInspectionDate) : "Not scheduled"]]).map(([label, value]) => <div key={label}><dt className="eyebrow">{label}</dt><dd className="mt-1 font-mono text-sm font-semibold text-navy">{value}</dd></div>)}</dl>
        <p className="text-xs text-slate-500">{IS_AMS ? "The alerts and activity log are updated. Print the report or show its QR code from Reports." : "The register, alerts and activity log are updated. Print it or create its QR from Certificates."}</p>
        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">{queue.length > 0 && <Button variant="outline" onClick={() => select()}>Review next · {queue.length} waiting</Button>}{issued?.joints && <Button variant="outline" onClick={() => setTallyReport(issued.id)}><FileText data-icon="inline-start" />View report</Button>}<Button asChild><Link href="/certificates">{IS_AMS ? "Open Reports" : "Open certificates"}<ArrowRight data-icon="inline-end" /></Link></Button></div>
      </CardContent>
    </Card> : selected && selectedRecord ? <Card><CardHeader className="border-b border-line"><div className="flex items-start justify-between gap-3"><div><div className="eyebrow">{selectedRecord.assetRef} · {selectedRecord.site}</div><CardTitle className="mt-1">{selected.title ?? "Review inspection"}</CardTitle></div><Badge variant={selected.status === "Returned" ? "danger" : "warning"}>{selected.status}</Badge></div></CardHeader><CardContent className="flex flex-col gap-5 p-5">{selected.joints ? <TallyReview inspection={selected} onReport={() => setTallyReport(selected.id)} /> : IS_FLS ? <><ResultCounts checklist={selected.checklist} /><ChecklistSections key={selected.id} name={`review-${selected.id}`} items={selected.checklist} results={Object.fromEntries(selected.checklist.map((item) => [item.id, item.result === "pending" ? undefined : item.result]))} onAnswer={() => undefined} disabled /></> : <div className="grid gap-2">{selected.checklist.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm"><span className="text-slate-600">{item.label}</span><Badge className="shrink-0" variant={item.result === "fail" ? "danger" : item.result === "pass" || item.result === "na" ? "success" : "warning"}>{item.result === "pending" ? "pending" : RESULT_LABELS[item.result]}</Badge></div>)}</div>}{selected.photos?.length ? <div><div className="eyebrow">Evidence photos</div><div className="mt-2 flex flex-wrap gap-2">{selected.photos.map((photo) => <button key={photo.id} type="button" className="focus-ring cursor-zoom-in overflow-hidden rounded-lg border border-line transition-transform active:scale-[.97]" onClick={() => setViewing(photo)} aria-label={`View ${photo.name} larger`}><img src={photo.dataUrl} alt={photo.name} className="size-24 object-cover" /></button>)}</div></div> : null}{selected.signature && <div><div className="eyebrow">{IS_FLS ? "Technician signature" : "Inspector signature"}</div><img src={selected.signature} alt={`Signature of ${selected.inspector}`} className="mt-2 h-16 rounded-lg border border-line bg-white px-2" /></div>}{selected.notes && <div className="rounded-lg bg-paper px-3 py-3 text-sm text-slate-600"><div className="eyebrow mb-1">{IS_FLS ? "Comments" : "Inspector notes"}</div>{selected.notes}</div>}<div><label className="eyebrow" htmlFor="review-comment">Correction comment for a return</label><Textarea id="review-comment" className="mt-1.5" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Required when sending this back…" disabled={!canReview || selected.status !== "Submitted"} /></div>{!IS_FLS && <div className="rounded-lg border border-[#b8cedc] bg-[#eef7fb] p-4"><div className="flex items-center gap-2 text-sm font-semibold text-navy"><ShieldCheck className="size-4 text-accent" />{IS_AMS ? "Issue report" : "Issue certificate"}</div><p className="mt-1 text-xs leading-relaxed text-slate-500">{IS_AMS ? "The report gets the next number and a QR code. Rejected joints stay listed on it." : "Expiry is explicit. The existing licence, certificate and retirement dates remain independent."}</p><label className="eyebrow mt-4 block" htmlFor="certificate-expiry">{IS_AMS ? "Report valid until" : "Certificate expiry"}</label><Input id="certificate-expiry" type="date" className="mt-1.5 max-w-xs" value={expiry} onChange={(event) => setExpiry(event.target.value)} disabled={!canReview || selected.status !== "Submitted"} /></div>}{message && <p className="text-sm text-navy" role="status">{message}</p>}{selected.status === "Returned" && <p className="text-sm text-danger">This item is waiting for the inspector to resubmit corrections.</p>}<div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4"><Button variant="outline" onClick={returnWork} disabled={!canReview || selected.status !== "Submitted"}><MessageSquareReply data-icon="inline-start" />Return with correction</Button><Button onClick={approve} disabled={!canReview || selected.status !== "Submitted" || selected.checklist.some((item) => item.result === "pending" || (!IS_FLS && item.result === "fail"))}><CheckCircle2 data-icon="inline-start" />{IS_FLS ? "Approve checklist" : IS_AMS ? "Approve & issue report" : "Approve & issue"}</Button></div></CardContent></Card> : <Card><CardContent className="flex min-h-[420px] items-center justify-center p-8 text-center text-sm text-slate-500">Select a submitted {IS_FLS ? "checklist" : IS_AMS ? "tally sheet" : "inspection"} to review.</CardContent></Card>}
  </div>;
}
