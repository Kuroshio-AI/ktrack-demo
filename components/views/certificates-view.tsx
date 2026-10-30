"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, ExternalLink, FileBadge, Printer, QrCode, ShieldCheck } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { useOnline } from "@/components/offline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TallyReportDialog } from "@/components/tally-report";
import { Signature, WarrantyDocument, type WarrantyPrint } from "@/components/warranty-document";
import { IS_AMS } from "@/lib/client";
import { effectiveCertificateStatus, revokeCertificate } from "@/lib/domain";
import { qrFor, warrantyPrint } from "@/lib/qr";
import { summarizeTally } from "@/lib/tally";
import type { AssetRecord, Certificate } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const OFFLINE_QR = IS_AMS ? "QR codes come from our server, so this one needs the connection. The report still prints offline, and its QR is added when you're back online." : "QR codes come from our server, so this one needs the connection.";

function snapshot(record: AssetRecord, certificate: Certificate, demoDate: string) {
  return { certificateNo: certificate.number, assetRef: record.assetRef, assetType: record.assetType, issuedDate: certificate.issuedDate, expiryDate: certificate.expiryDate, status: effectiveCertificateStatus(certificate, demoDate) };
}
type QrSnapshot = { image: string; url: string; key: string; createdAt: number };
type PrintSnapshot = ReturnType<typeof snapshot> & { result: string; qr: string; site: string; serialNo?: string; inspector?: string; inspectorSignature?: string; inspectedAt?: string; approvedAt?: string; nextInspection?: string };

export function CertificatesView() {
  const { state, update } = useApp();
  const currentState = useRef(state);
  useEffect(() => { currentState.current = state; }, [state]);
  const [qr, setQr] = useState<Record<string, QrSnapshot>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string>();
  const [printing, setPrinting] = useState<({ kind: "certificate" } & PrintSnapshot) | ({ kind: "warranty" } & WarrantyPrint)>();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (printing) dialog.current?.showModal(); }, [printing]);
  // The QR opens in a dialog so a card with a QR stays the same size as its neighbours.
  const [qrOpen, setQrOpen] = useState<string>();
  // AMS prints the tally sheet's summary report, with the verification QR on it.
  // qr is empty while a report opened offline waits for the connection.
  const [tallyPrint, setTallyPrint] = useState<{ inspectionId: string; recordId: string; certificateId: string; qr: string }>();
  const online = useOnline();
  const [copied, setCopied] = useState(false);
  const qrDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (qrOpen) qrDialog.current?.showModal(); }, [qrOpen]);
  const canChange = state.role === "Admin" || state.role === "Reviewer";
  const certificates = state.records.flatMap((record) => record.certificates.map((certificate) => ({ record, certificate })));
  const shown = qrOpen ? qr[qrOpen] : undefined;
  const opened = certificates.find(({ certificate }) => certificate.id === qrOpen);

  function currentQr(record: AssetRecord, certificate: Certificate) {
    const cached = qr[certificate.id];
    return cached?.key === JSON.stringify(snapshot(record, certificate, state.demoDate)) && Date.now() - cached.createdAt < 24 * 60 * 60 * 1000 ? cached : undefined;
  }

  async function makeQr(record: AssetRecord, certificate: Certificate): Promise<QrSnapshot | undefined> {
    setError(""); setBusy(certificate.id);
    const payload = snapshot(record, certificate, state.demoDate);
    // One key per certificate, saved with it, so a later revoke reaches every QR made for it.
    const statusKey = certificate.statusKey ?? crypto.randomUUID();
    if (!certificate.statusKey && !update((current) => ({ ...current, records: current.records.map((item) => item.id === record.id ? { ...item, certificates: item.certificates.map((cert) => cert.id === certificate.id ? { ...cert, statusKey: cert.statusKey ?? statusKey } : cert) } : item) }))) { setBusy(undefined); return; }
    try {
      const { image, url } = await qrFor({ ...payload, statusKey });
      const latestRecord = currentState.current.records.find((item) => item.id === record.id);
      const latestCertificate = latestRecord?.certificates.find((item) => item.id === certificate.id);
      if (!latestRecord || !latestCertificate || JSON.stringify(payload) !== JSON.stringify(snapshot(latestRecord, latestCertificate, currentState.current.demoDate))) throw new Error("Certificate changed while generating this QR. Please try again.");
      const result = { image, url, key: JSON.stringify(payload), createdAt: Date.now() };
      setQr((current) => ({ ...current, [certificate.id]: result }));
      return result;
    } catch (reason) { setError(!navigator.onLine ? OFFLINE_QR : reason instanceof Error ? reason.message : "QR generation failed. Try again."); }
    finally { setBusy(undefined); }
  }

  async function showQr(record: AssetRecord, certificate: Certificate) {
    if (!currentQr(record, certificate) && !navigator.onLine) { setError(OFFLINE_QR); return; }
    if (currentQr(record, certificate) ?? await makeQr(record, certificate)) setQrOpen(certificate.id);
  }

  async function copyLink(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError("Copy failed. Use Open verification instead."); }
  }

  // Superseding happens automatically when a newer certificate is approved, so revoke is the only manual status change.
  function revoke(record: AssetRecord, certificate: Certificate) {
    if (!window.confirm(`Revoke ${certificate.number} for ${record.assetRef}? This cannot be undone.`)) return;
    // Offline, the new status waits in the outbox; the QR is remade the next time it's shown.
    if (update((current) => revokeCertificate(current, record.id, certificate.id)) && navigator.onLine) void makeQr(record, { ...certificate, status: "Revoked" });
  }

  async function print(record: AssetRecord, certificate: Certificate) {
    const inspection = state.inspections.find((item) => item.id === certificate.sourceInspectionId);
    const tally = inspection?.joints ? { inspectionId: inspection.id, recordId: record.id, certificateId: certificate.id } : undefined;
    // A tally report still opens and prints offline. Its QR comes from our server, so it is added once the laptop reconnects.
    if (tally && !navigator.onLine) { setTallyPrint({ ...tally, qr: "" }); return; }
    const fresh = await makeQr(record, certificate);
    if (fresh && tally) { setTallyPrint({ ...tally, qr: fresh.image }); return; }
    if (fresh) setPrinting({ kind: "certificate", ...snapshot(record, certificate, state.demoDate), result: certificate.result, qr: fresh.image, site: record.site, serialNo: record.serialNo, inspector: inspection?.inspector, inspectorSignature: inspection?.signature, inspectedAt: inspection?.submittedAt, approvedAt: inspection?.reviewedAt, nextInspection: inspection?.nextInspectionDate ?? record.inspectionDueDate });
  }

  // A report opened offline gets its QR as soon as the connection is back.
  useEffect(() => {
    if (!online || !tallyPrint || tallyPrint.qr) return;
    const record = currentState.current.records.find((item) => item.id === tallyPrint.recordId);
    const certificate = record?.certificates.find((item) => item.id === tallyPrint.certificateId);
    if (record && certificate) void makeQr(record, certificate).then((fresh) => { if (fresh) setTallyPrint((current) => current?.certificateId === certificate.id ? { ...current, qr: fresh.image } : current); });
  }, [online, tallyPrint]);

  async function printWarranty(record: AssetRecord) {
    setError(""); setBusy(`warranty:${record.id}`);
    try { setPrinting({ kind: "warranty", ...await warrantyPrint(record, state.demoDate) }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Warranty could not be prepared. Try again."); }
    finally { setBusy(undefined); }
  }

  return <div className="flex flex-col gap-5">
    <Card><CardHeader><div className="eyebrow">{IS_AMS ? "Report register" : "Certificate register"}</div><CardTitle>{certificates.length} {IS_AMS ? "report" : "certificate"}{certificates.length === 1 ? "" : "s"}</CardTitle></CardHeader>
      <CardContent>{certificates.length ? <div className="grid gap-4 xl:grid-cols-2">{certificates.map(({ record, certificate }) => {
        const details = snapshot(record, certificate, state.demoDate);
        const tally = state.inspections.find((item) => item.id === certificate.sourceInspectionId && item.joints);
        const counts = tally?.job && summarizeTally(tally.connection!, tally.job, tally.joints!);
        return <div key={certificate.id} className="min-w-0 rounded-xl border border-line bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">{record.assetRef} · {counts ? `${record.owner} · ` : ""}{record.site}</div><h3 className="mt-1 break-all text-lg font-bold text-navy">{certificate.number}</h3><p className="mt-1 text-sm text-slate-500">{record.assetType}{counts && ` · ${counts.total} pipes, ${counts.accepted} accepted, ${counts.downgraded.length} not accepted`}</p></div><Badge variant={details.status === "Valid" ? "success" : details.status === "Expired" ? "warning" : "danger"}>{details.status}</Badge></div>
          <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-paper p-3 text-sm"><div><div className="eyebrow">Issued</div><div className="mt-1 font-semibold text-navy">{formatDate(certificate.issuedDate)}</div></div><div><div className="eyebrow">Expires</div><div className="mt-1 font-semibold text-navy">{formatDate(certificate.expiryDate)}</div></div></div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => void print(record, certificate)}><Printer />Print</Button>
            {!IS_AMS && <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => void printWarranty(record)}><FileBadge />{busy === `warranty:${record.id}` ? "Preparing…" : "Warranty"}</Button>}
            <Button variant="secondary" size="sm" disabled={Boolean(busy)} onClick={() => void showQr(record, certificate)}><QrCode />{busy === certificate.id ? "Generating…" : currentQr(record, certificate) ? "Show QR" : "Create QR"}</Button>
            {canChange && (details.status === "Valid" || details.status === "Expired") && <Button variant="ghost" size="sm" className="text-danger" disabled={Boolean(busy)} onClick={() => revoke(record, certificate)}>Revoke</Button>}
          </div>
        </div>;
      })}</div> : <div className="rounded-lg border border-dashed border-line px-4 py-14 text-center"><ShieldCheck className="mx-auto size-9 text-[#b8cedc]" /><p className="mt-3 text-sm text-slate-500">{IS_AMS ? "Approve a submitted tally sheet to issue its report." : "Import a supplied certificate or approve a passed inspection to begin."}</p></div>}
        {error && <p className="mt-4 rounded-lg bg-[#fff3f3] p-3 text-sm text-danger" role="alert">{error}</p>}
      </CardContent>
    </Card>
    {shown && opened && createPortal(<dialog ref={qrDialog} aria-labelledby="qr-title" onClose={() => { setQrOpen(undefined); setCopied(false); }} className="animate-rise fixed inset-0 m-auto w-[min(92vw,380px)] rounded-2xl bg-white p-6 text-center backdrop:bg-black/50">
      <div className="eyebrow">{opened.record.assetRef} · Scan to verify</div>
      <h2 id="qr-title" className="mt-1 break-all text-lg font-bold text-navy">{opened.certificate.number}</h2>
      <img src={shown.image} alt={`QR code for ${opened.certificate.number}`} className="mx-auto mt-3 size-64" />
      <p className="text-xs leading-relaxed text-slate-500">Status now: {effectiveCertificateStatus(opened.certificate, state.demoDate)}. If this {IS_AMS ? "report" : "certificate"} is revoked, the QR shows it, even on a printed copy. The link works for 24 hours.</p>
      {error && <p className="mt-3 rounded-lg bg-[#fff3f3] p-2 text-xs text-danger" role="alert">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button asChild size="sm"><a href={shown.url} target="_blank" rel="noreferrer"><ExternalLink />Open verification</a></Button>
        <Button variant="outline" size="sm" onClick={() => void copyLink(shown.url)}>{copied ? <Check /> : <Copy />}<span aria-live="polite">{copied ? "Copied" : "Copy link"}</span></Button>
        <Button variant="ghost" size="sm" onClick={() => qrDialog.current?.close()}>Close</Button>
      </div>
    </dialog>, document.body)}
    {tallyPrint && <TallyReportDialog inspectionId={tallyPrint.inspectionId} qr={tallyPrint.qr} qrPending={!tallyPrint.qr} onClose={() => setTallyPrint(undefined)} />}
    {printing && createPortal(<dialog ref={dialog} aria-label={printing.kind === "warranty" ? "Warranty print preview" : "Certificate print preview"} onClose={() => setPrinting(undefined)} className="certificate-print-area animate-rise fixed inset-0 m-auto max-h-[95vh] w-[min(95vw,850px)] overflow-auto bg-white p-5 backdrop:bg-black/50 sm:p-10">
      <div className="print-hidden mb-5 flex justify-end gap-2"><Button onClick={() => window.print()}>Print / Save PDF</Button><Button variant="outline" onClick={() => dialog.current?.close()}>Close</Button></div>
      {printing.kind === "warranty" ? <WarrantyDocument {...printing} /> : <div className="mx-auto border-[8px] border-[#0b3151] p-1"><div className="border border-[#b8cedc] p-5 sm:p-10">
        <div className="flex items-start justify-between gap-4"><div><div className="text-xs font-bold uppercase tracking-[.2em] text-accent">Kee Safety · KTrack</div><h2 className="mt-5 text-3xl font-black tracking-tight text-navy">Certificate of inspection</h2></div><Badge variant="warning">DEMO</Badge></div>
        <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
          <div className="col-span-2"><dt className="eyebrow">Certificate number</dt><dd className="mt-1 break-all text-lg font-bold text-navy">{printing.certificateNo}</dd></div>
          <div><dt className="eyebrow">Result / status</dt><dd className="mt-1 text-lg font-bold text-navy">{printing.result} · {printing.status}</dd></div>
          {[["Asset", `${printing.assetRef} · ${printing.assetType}`], ["Serial number", printing.serialNo ?? "Not supplied"], ["Site", printing.site], ["Issued", formatDate(printing.issuedDate)], ["Expires", formatDate(printing.expiryDate)], ["Next inspection due", printing.nextInspection ? formatDate(printing.nextInspection) : "Not scheduled"]].map(([label, value]) => <div key={label}><dt className="eyebrow">{label}</dt><dd className="mt-1 font-semibold text-navy">{value}</dd></div>)}
        </dl>
        <div className="mt-8 flex flex-col gap-8 border-t border-line pt-6 sm:flex-row sm:items-end">
          <div className="shrink-0 text-center"><img src={printing.qr} alt="Certificate verification QR" className="mx-auto size-36" /><div className="eyebrow mt-1">Scan to verify</div></div>
          <div className="grid flex-1 gap-8 sm:grid-cols-2"><Signature label="Inspected by" name={printing.inspector ?? "Not recorded"} date={printing.inspectedAt} image={printing.inspectorSignature} /><Signature label="Approved by" name="Authorised reviewer" date={printing.approvedAt} /></div>
        </div>
        <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-slate-500">Demo certificate · fictional data. The QR shows this certificate&apos;s current status for 24 hours.</p>
      </div></div>}
    </dialog>, document.body)}
  </div>;
}
