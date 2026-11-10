// No "use client": only client views render it, and it takes a callback.
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { GEX_NAME } from "@/lib/client";
import { effectiveCertificateStatus } from "@/lib/domain";
import { alloyLabel, checkLot, limitNumber, type LotRow } from "@/lib/gex-check";
import type { GexCheck } from "@/lib/types";
import { formatDate, formatLocalDate } from "@/lib/utils";

// Document tokens, sized in pt/mm for paper. Red only ever means "not OK" or a status, never decoration.
const LABEL = "cert-caps text-[6.5pt] font-medium leading-tight text-[#5d6b78]";
const SERIF = "[font-family:var(--font-plex-serif),Georgia,serif]";
const CELL = "border-[0.5px] border-[#b7c2cc] px-[1.8mm] py-[0.6mm] leading-tight";
const HEAD = `${CELL} ${LABEL} bg-[#eef2f5] font-semibold`;
const FAIL = "font-bold text-[#a3191f] underline decoration-[0.75pt] underline-offset-2";
const DASH = "–";
const METHOD: Record<GexCheck, string> = { dimensions: "Gauged to drawing", surface: "Visual, 5 pcs", adhesion: "Cross-cut, GT0", seal: "Dye spot" };

const Field = ({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) => <div className={`px-[1.8mm] py-[1mm] ${className}`}><div className={LABEL}>{label}</div><div className="mt-[0.4mm] leading-snug">{children}</div></div>;
const Section = ({ no, title, caption, className = "", children }: { no: number; title: string; caption?: string; className?: string; children: ReactNode }) => <section className={`break-inside-avoid ${className}`}>
  <h3 className="mb-[1.5mm] flex items-baseline border-b-[0.75pt] border-[#0b3151] pb-[1mm] text-[#0b3151]"><span className="tally-mono font-semibold">{no}</span><span className="cert-caps ml-[2.5mm] text-[8.5pt] font-semibold">{title}</span>{caption && <span className="ml-auto text-[7pt] text-[#5d6b78]">{caption}</span>}</h3>{children}</section>;
const Tick = ({ on, label }: { on: boolean; label: string }) => <span className="inline-flex items-center gap-[1mm] text-[7pt]"><span className="inline-grid size-[2.6mm] place-items-center border-[0.5pt] border-[#14202b] text-[6pt] leading-none text-[#0b3151]">{on ? "✕" : ""}</span>{label}</span>;
const Verdict = ({ ok, pending = "Not tested" }: { ok?: boolean; pending?: string }) => ok === undefined ? <span className="text-[#5d6b78]">{pending}</span> : ok ? <>Pass</> : <span className="font-bold text-[#a3191f]">FAIL</span>;

// Property | unit | spec min | spec max | actual | result: one row per checkLot row, so the limits logic matches Approvals.
function CertTable({ rows, checks = [] }: { rows: LotRow[]; checks?: { key: GexCheck; label: string; value?: boolean }[] }) {
  return <table className="w-full table-fixed border-collapse text-[8pt]">
    <colgroup><col className="w-[36%]" /><col className="w-[10%]" /><col className="w-[13%]" /><col className="w-[13%]" /><col className="w-[14%]" /><col className="w-[14%]" /></colgroup>
    <thead><tr>{["Property", "Unit", "Spec. min", "Spec. max", "Actual", "Result"].map((label, index) => <th key={label} className={`${HEAD} ${index ? "text-center" : "text-left"}`}>{label}</th>)}</tr></thead>
    <tbody>
      {rows.map((row) => <tr key={row.key}><td className={CELL}>{row.label}</td><td className={`${CELL} text-center text-[#5d6b78]`}>{row.unit}</td>
        {[row.min, row.max].map((limit, index) => <td key={index} className={`${CELL} tally-mono text-center text-[#5d6b78]`}>{limit === undefined ? DASH : limitNumber(limit)}</td>)}
        <td className={`${CELL} tally-mono text-center font-semibold ${row.ok === false ? FAIL : ""}`}>{row.value === undefined ? DASH : row.value}</td><td className={`${CELL} text-center`}><Verdict ok={row.ok} /></td></tr>)}
      {checks.map((check) => <tr key={check.key}><td className={CELL}>{check.label}</td><td colSpan={3} className={`${CELL} text-center text-[#5d6b78]`}>{METHOD[check.key]}</td>
        <td className={`${CELL} text-center`}><span className="inline-flex gap-[2mm] whitespace-nowrap"><Tick on={check.value === true} label="OK" /><Tick on={check.value === false} label="Not OK" /></span></td><td className={`${CELL} text-center`}><Verdict ok={check.value} pending="Pending" /></td></tr>)}
    </tbody>
  </table>;
}

// A rubber QC stamp in navy ink: it names what it cleared (lot and date), the way a real inspection stamp does.
function Stamp({ passed, lot, date }: { passed: boolean; lot: string; date: string }) {
  return <svg viewBox="0 0 120 120" aria-label="Quality control stamp" className="stamp cert-stamp -ml-[12mm] size-[30mm] shrink-0 text-[#0b3151] opacity-80 mix-blend-multiply" fill="none" stroke="currentColor">
    <circle cx="60" cy="60" r="56" strokeWidth="2.2" /><circle cx="60" cy="60" r="50" strokeWidth="0.8" /><circle cx="60" cy="60" r="32" strokeWidth="0.8" />
    <defs><path id="cert-stamp-ring" d="M60,60 m-43,0 a43,43 0 1,1 86,0 a43,43 0 1,1 -86,0" /></defs>
    <text fill="currentColor" stroke="none" fontSize="9" fontWeight="600" letterSpacing="1.5" style={{ fontFamily: "var(--font-plex), sans-serif" }}><textPath href="#cert-stamp-ring" textLength="266" lengthAdjust="spacing">{`${GEX_NAME} · QUALITY CONTROL ·`.toUpperCase()}</textPath></text>
    <g fill="currentColor" stroke="none" textAnchor="middle">
      <text x="60" y="58" fontSize="9" fontWeight="600" textLength="54" lengthAdjust="spacingAndGlyphs" style={{ fontFamily: "var(--font-plex-serif), serif" }}>{passed ? "QC PASSED" : "QC FAILED"}</text>
      <text x="60" y="68" fontSize="7" style={{ fontFamily: "var(--font-plex-mono), monospace" }}>{lot}</text><text x="60" y="77" fontSize="7" style={{ fontFamily: "var(--font-plex-mono), monospace" }}>{date.toUpperCase()}</text></g>
  </svg>;
}

const Sign = ({ name, role, date, image, muted }: { name: string; role: string; date?: string; image?: string; muted?: boolean }) => <div>
  <div className="flex h-[12mm] items-end border-b-[0.5pt] border-[#14202b] pb-[0.8mm]">{image ? <img src={image} alt="" className="h-full" /> : date && <span className="text-[7pt] italic text-[#5d6b78]">Signed electronically · {formatLocalDate(date)}</span>}</div>
  <div className={`mt-[1mm] text-[9pt] font-medium ${muted ? "text-[#5d6b78]" : ""}`}>{name}</div><div className="text-[7pt] text-[#5d6b78]">{role}{date ? ` · ${formatLocalDate(date)}` : ""}</div></div>;

const STRIP: Record<string, string> = { Superseded: "this copy is no longer valid. Scan the QR code for the current certificate.", Revoked: "withdrawn by the issuer. Do not use.", Expired: "the validity period has ended.", Draft: "not approved, not for release." };

// GEX: one lot's quality certificate, a single portrait A4 page. Same contract as TallyReportDialog, so the certificates view
// opens either one; the default @page is A4 portrait, so it needs no print copy. Laid out like a mill sheet: issuer, number
// and the verification QR across the top, then the order, the product, numbered results and the signatories.
export function GexCertificateDialog({ inspectionId, qr, qrPending, onClose }: { inspectionId: string; qr?: string; qrPending?: boolean; onClose: () => void }) {
  const { state } = useApp();
  const dialog = useRef<HTMLDialogElement>(null);
  const inspection = state.inspections.find((item) => item.id === inspectionId);
  const record = state.records.find((item) => item.id === inspection?.assetId);
  const certificate = record?.certificates.find((item) => item.id === inspection?.certificateId);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const lot = inspection?.lot;
  if (!inspection || !record || !lot) return null;
  const status = certificate ? effectiveCertificateStatus(certificate, state.demoDate) : "Draft";
  const result = checkLot(lot);
  const alloy = alloyLabel(lot.spec);
  const certNo = certificate?.number ?? "DRAFT";
  const replaces = certificate && record.certificates.find((item) => item.id !== certificate.id && item.status === "Superseded" && item.issuedDate <= certificate.issuedDate);
  // Host only: the token stays in the QR, so the printed text never hands out the verify link.
  const host = (() => { try { return new URL(certificate?.verifyUrl ?? location.origin).host; } catch { return location.host; } })();
  const composition = result.rows.filter((row) => row.group === "Composition");
  const mechanical = result.rows.filter((row) => row.group === "Mechanical");
  const electrical = result.rows.filter((row) => row.group === "Electrical");
  const finish = result.rows.filter((row) => row.group === "Finish");
  // Side by side, with tighter cells, when both print, so a conductivity-tested alloy still fits one page.
  const half = mechanical.length > 0 && electrical.length > 0;
  const compositionOk = composition.some((row) => row.ok === false) ? false : composition.some((row) => row.value === undefined) ? undefined : true;
  const overprint = status === "Valid" ? undefined : status === "Expired" ? "text-[#0b3151]/[.14]" : status === "Draft" ? "text-[#5d6b78]/[.14]" : "text-[#a3191f]/[.18]";
  // Numbered in render order, so an absent group is skipped and the rest renumber.
  const sections = [
    composition.length > 0 && { title: "Chemical composition (% by weight)", caption: `Cast ${lot.castNo}`, body: <table className="w-full border-collapse text-center text-[8pt]">
      <thead><tr><th className={`${HEAD} w-[18mm] text-left`}>Element</th>{composition.map((row) => <th key={row.key} className={`${CELL} bg-[#eef2f5] font-semibold`}>{row.label}</th>)}<th className={`${HEAD} w-[20mm]`}>Conformity</th></tr></thead>
      <tbody>{(["Min", "Max", "Result"] as const).map((label) => <tr key={label}><th className={`${CELL} ${LABEL} text-left`}>{label}</th>
        {composition.map((row) => { const value = label === "Min" ? row.min : label === "Max" ? row.max : row.value; return <td key={row.key} className={`${CELL} tally-mono ${label === "Result" ? `font-semibold ${row.ok === false ? FAIL : ""}` : "text-[#5d6b78]"}`}>{value === undefined ? DASH : label === "Result" ? value.toFixed(3) : limitNumber(value)}</td>; })}
        <td className={CELL}>{label === "Result" && <Verdict ok={compositionOk} pending="Pending" />}</td></tr>)}</tbody>
    </table> },
    mechanical.length > 0 && { title: "Mechanical properties", half, body: <CertTable rows={mechanical} /> },
    electrical.length > 0 && { title: "Electrical properties", half, body: <CertTable rows={electrical} /> },
    (finish.length > 0 || result.checks.length > 0) && { title: lot.finish === "Mill" ? "Surface and dimensional inspection" : "Surface finish and inspection", body: <CertTable rows={finish} checks={result.checks} /> },
    { title: "Conformity", body: <p className="text-[8.5pt] leading-relaxed">{result.failed.length ? <><span className="font-bold text-[#a3191f]">Not conforming: {result.failed.join(", ")}.</span> This lot does not meet the limits specified for {alloy}.</>
      : result.pending ? `Testing incomplete: ${result.pending} result${result.pending === 1 ? "" : "s"} outstanding.` : `The material described above has been tested and found to comply with the limits specified for ${alloy}.`}</p> },
  ].filter((section) => section !== false);
  return createPortal(<dialog ref={dialog} aria-label={`${record.assetRef} quality certificate`} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }} className="certificate-print-area animate-rise fixed inset-0 m-auto max-h-[95vh] w-[min(95vw,820px)] overflow-auto bg-white p-5 backdrop:bg-black/50 sm:p-8">
    <div className="print-hidden mb-4 flex justify-end gap-2"><Button className="press" onClick={() => window.print()}><Printer data-icon="inline-start" />Print / Save PDF</Button><Button variant="outline" onClick={() => dialog.current?.close()}>Close</Button></div>
    <div className="cert-sheet mx-auto flex min-h-[272mm] w-[186mm] flex-col border-[0.75pt] border-[#0b3151] bg-white p-[1.2mm] text-[8.5pt] leading-normal text-[#14202b]">
      <div className="flex flex-1 flex-col border-[0.3pt] border-[#0b3151] px-[6mm] py-[4mm]">
        <header className="grid grid-cols-[1fr_58mm_40mm] gap-[3mm] border-b-[1pt] border-[#0b3151] pb-[3mm]">
          <div className="flex flex-col"><div className="text-[12pt] font-bold uppercase leading-none tracking-[.04em] text-[#0b3151]">{GEX_NAME}</div><div className="mt-[1mm] text-[7pt] text-[#5d6b78]">Aluminium extrusion · Quality department</div>
            <h2 className={`${SERIF} mt-auto pt-[4mm] text-[20pt] font-semibold leading-tight text-[#0b3151]`}>Quality Certificate</h2><div className="text-[8pt] text-[#5d6b78]">Production lot test results · {alloy}</div>{replaces && <div className="tally-mono mt-[0.5mm] text-[7pt] text-[#5d6b78]">Replaces {replaces.number}</div>}</div>
          <div className="grid grid-cols-2 grid-rows-[auto_1fr_1fr] border-[0.5px] border-[#b7c2cc] [&>*]:border-[#b7c2cc]">
            <Field label="Certificate no." className="col-span-2 border-b-[0.5px]">{certificate ? <span className="tally-mono break-all text-[12pt] font-semibold tracking-[.04em] text-[#0b3151]">{certificate.number}</span> : <span className="text-[#5d6b78]">Draft, not issued</span>}</Field>
            <Field label="Date of issue" className="border-b-[0.5px] border-r-[0.5px]"><span className="tally-mono">{certificate ? formatDate(certificate.issuedDate) : DASH}</span></Field>
            <Field label="Valid until" className="border-b-[0.5px]"><span className="tally-mono">{certificate?.expiryDate ? formatDate(certificate.expiryDate) : DASH}</span></Field>
            <Field label="Status" className="border-r-[0.5px]"><span className={status === "Valid" ? "" : status === "Draft" ? "text-[#5d6b78]" : "font-bold uppercase text-[#a3191f]"}>{status}</span></Field>
            <Field label="Copy"><span className="text-[#5d6b78]">Specimen</span></Field>
          </div>
          <div className="flex flex-col items-center border-[0.5px] border-[#b7c2cc] p-[1.2mm] pb-[1.5mm] text-center">
            {qr && certificate ? <img src={qr} alt="Certificate verification QR" className="size-[36mm]" />
              : <div className="grid size-[36mm] place-items-center border border-dashed border-[#b7c2cc] p-[2mm] text-[6.5pt] leading-snug text-[#5d6b78]">{!certificate ? "Issued on approval" : qrPending ? "QR added when back online" : "QR on the issued copy"}</div>}
            <div className={`${LABEL} mt-[1mm] font-semibold text-[#0b3151]`}>Scan to verify</div><div className="break-all text-[6pt] leading-tight text-[#5d6b78]">Live status at <span className="tally-mono text-[#14202b]">{host}</span></div>
          </div>
        </header>
        <div aria-hidden className="tally-mono overflow-hidden whitespace-nowrap border-b-[0.5px] border-[#0b3151] py-[0.3mm] text-[4.5pt] leading-none text-[#0b3151]/55">{`QUALITY CERTIFICATE · ${certNo} · SPECIMEN · `.repeat(30)}</div>
        {status !== "Valid" && <p className={`mt-[3mm] border-[1pt] p-[2mm] text-[8.5pt] font-bold ${status === "Draft" ? "border-[#5d6b78] text-[#5d6b78]" : "border-[#a3191f] text-[#a3191f]"}`}>{status.toUpperCase()}{status === "Expired" && certificate ? ` ${formatDate(certificate.expiryDate)}` : ""}: {STRIP[status]}</p>}
        <div className="mt-[3mm] grid grid-cols-[2fr_1fr_1fr_1fr] border-[0.5px] border-[#b7c2cc] text-[9pt] font-medium [&>*+*]:border-l-[0.5px] [&>*]:border-[#b7c2cc]">
          <Field label="Customer">{lot.customer}</Field><Field label="Sales order">{lot.orderNo}</Field><Field label="Customer PO">{lot.customerPo}</Field><Field label="Delivery note">{lot.deliveryNote}</Field>
        </div>
        <table className="mt-[3mm] w-full border-collapse text-center text-[8.5pt]">
          <thead><tr>{["Lot no.", "Cast no.", "Alloy", "Temper", "Profile / die", "Pieces", "Cut length (mm)", "Finish"].map((label) => <th key={label} className={`${HEAD} whitespace-nowrap`}>{label}</th>)}</tr></thead>
          <tbody><tr><td className={`${CELL} tally-mono whitespace-nowrap`}>{record.assetRef}</td><td className={`${CELL} tally-mono whitespace-nowrap`}>{lot.castNo}</td><td className={CELL}>{lot.spec.alloy}</td><td className={CELL}>{lot.spec.temper}</td><td className={`${CELL} tally-mono break-all`}>{lot.profile}</td><td className={`${CELL} tally-mono`}>{lot.quantity}</td><td className={`${CELL} tally-mono`}>{lot.lengthMm}</td><td className={CELL}>{lot.colour ? `${lot.finish} · ${lot.colour}` : lot.finish}</td></tr></tbody>
        </table>
        <div className="relative mt-[3mm] grid grid-cols-2 gap-x-[4mm] gap-y-[3mm]">
          {sections.map((section, index) => <Section key={section.title} no={index + 1} title={section.title} caption={section.caption} className={"half" in section && section.half ? "[&_td]:px-[0.8mm] [&_th]:px-[0.8mm]" : "col-span-2"}>{section.body}</Section>)}
          {/* Above the tables so the header tint cannot hide it; multiply lets the figures show through. */}
          {overprint && <div aria-hidden className={`pointer-events-none absolute inset-0 z-10 grid place-items-center overflow-hidden mix-blend-multiply ${overprint}`}><span className={`${SERIF} -rotate-[28deg] border-[3px] border-double border-current px-[5mm] py-[3mm] text-[44pt] font-semibold uppercase leading-none tracking-[.12em]`}>{status}</span></div>}
        </div>
        <div className="mt-[4mm] grid break-inside-avoid grid-cols-[1fr_1fr_40mm] items-start gap-[6mm]">
          <Sign name={inspection.inspector} role="Checked by" date={inspection.submittedAt} image={inspection.signature} />
          <div><Sign name={certificate ? "Quality reviewer" : "Awaiting approval"} role="Approved by" date={certificate ? inspection.reviewedAt : undefined} muted={!certificate} /><div className={`${LABEL} mt-[0.5mm]`}>Authorised signatory</div></div>
          {certificate ? <Stamp passed={certificate.result === "Pass"} lot={record.assetRef} date={inspection.reviewedAt ? formatLocalDate(inspection.reviewedAt) : formatDate(certificate.issuedDate)} />
            : <div className={`${LABEL} grid size-[30mm] place-items-center border border-dashed border-[#b7c2cc]`}>Stamp</div>}
        </div>
        <div className="flex-1" />
        <footer className="mt-[3mm] border-t-[0.5pt] border-[#0b3151] pt-[1.5mm] text-[6.5pt] leading-relaxed text-[#5d6b78]">
          <div className="flex justify-between gap-[4mm]"><span>Form QC-F01 · Rev 2</span><span>Issued electronically. Scan the QR code to see this certificate's current status.</span><span>Page 1 of 1</span></div>
          <div>SPECIMEN · demonstration document with invented data and sample limits · generated with KTrack · {certNo}</div>
        </footer>
      </div>
    </div>
  </dialog>, document.body);
}
