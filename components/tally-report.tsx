// No "use client": only client views render it, and it takes a callback.
import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Signature } from "@/components/warranty-document";
import { ADDITIONAL_SERVICES, INSPECTION_PROGRAM } from "@/lib/ams";
import { AMS_NAME } from "@/lib/client";
import { CODES, gradePipe, inches, limitFailure, limitFor, limitText, readingText, reasons, summarizeTally, TALLY_COLUMNS, type Group } from "@/lib/tally";
import type { AssetRecord, Certificate, Equipment, FinalClass, Inspection } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export const CLASS_TONE: Record<FinalClass | "Pending", string> = {
  "Class 1 (New)": "text-success", "Premium-Accepted": "text-success", "Class 1-Rework": "text-[#8a5d00]", "Premium-Rework": "text-[#8a5d00]",
  "Class-2": "text-[#b45309]", Bent: "text-[#b45309]", Scrap: "text-danger", Pending: "text-slate-400",
};

const GROUPS: Group[] = ["Pipe body", "Box tool joint", "Pin tool joint"];
const Box = ({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) => <section className={`break-inside-avoid border border-[#0b3151] ${className}`}>{title && <h3 className="form-band border-b border-[#0b3151] px-2 py-1 text-center text-[10px] font-bold uppercase tracking-[.1em]">{title}</h3>}{children}</section>;
const Tick = ({ on, label }: { on: boolean; label: string }) => <li className="flex items-center gap-1.5"><span className={`grid size-3.5 place-items-center border border-[#0b3151] text-[9px] font-black leading-none ${on ? "bg-[#0b3151] text-white" : ""}`}>{on ? "✓" : ""}</span>{label}</li>;

// The F.581 summary report, filled from the tally: the same sections in the same order as the client's paper form, then the
// F.582 tally itself as a landscape page. KTrack adds the report number, the QR code and the inspector's signature.
export function TallyReport({ inspection, record, certificate, equipment, qr }: { inspection: Inspection; record: AssetRecord; certificate?: Certificate; equipment: Equipment[]; qr?: string }) {
  const spec = inspection.connection;
  const job = inspection.job;
  const joints = inspection.joints ?? [];
  if (!spec || !job) return null;
  const summary = summarizeTally(spec, job, joints);
  const date = certificate?.issuedDate ?? inspection.submittedAt?.slice(0, 10);
  const header: [string, string][][] = [
    [["Customer", record.owner], ["Report no.", certificate?.number ?? "Draft, not issued"], ["Date", date ? formatDate(date) : "–"]],
    [["Location", job.location || "–"], ["Work order no.", record.assetRef], ["Rig · Well #", `${record.site} · ${job.well || "–"}`]],
    [["Inspection standard", job.standard], ["Service cat.", job.serviceCategory], ["Inspector", inspection.inspector]],
  ];
  const material: [string, string][] = [["Quantity", String(joints.length)], ["Grade", spec.grade], ["Pipe size", `${spec.size}"`], ["Tool joint OD", job.toolJointOd || "–"], ["Pipe range", job.range], ["Hard band", job.hardBand || "–"], ["Nom. weight lb/ft", spec.weight], ["Tool joint connection", spec.connection], ["Wall thickness", inches(job.nominalWall)], ["Pin ID", job.pinId || "–"]];
  const limits = TALLY_COLUMNS.map((column) => limitFor(column, spec, job));
  return <div className="text-[10.5px] leading-snug text-ink">
    <div className="f581-page border-[3px] border-[#0b3151] p-4 sm:p-6">
      <header className="text-center"><div className="text-lg font-black uppercase tracking-[.08em] text-navy">{AMS_NAME}</div><div className="text-xs font-bold uppercase tracking-[.12em] text-slate-600">Drill pipe inspection summary report</div></header>

      <Box className="mt-4"><table className="w-full border-collapse"><tbody>{header.map((row, index) => <tr key={index} className="border-b border-[#0b3151] last:border-b-0">{row.map(([label, value]) => <Fragment key={label}><th className="w-[16%] border-r border-[#0b3151] bg-[#fbf4ee] px-2 py-1 text-left text-[9.5px] font-bold uppercase">{label}</th><td className={`border-r border-[#0b3151] px-2 py-1 font-semibold text-navy last:border-r-0 ${label === "Report no." ? "tally-mono" : ""}`}>{value}</td></Fragment>)}</tr>)}</tbody></table></Box>

      <Box className="mt-2"><div className="grid grid-cols-[1.4fr_1fr] divide-x divide-[#0b3151]">
        <div className="px-3 py-2"><div className="text-center text-[9.5px] font-bold uppercase tracking-[.1em]">Inspection program</div><ul className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1">{INSPECTION_PROGRAM.map((item) => <Tick key={item} on={job.program.includes(item)} label={item} />)}</ul></div>
        <div className="px-3 py-2"><div className="text-center text-[9.5px] font-bold uppercase tracking-[.1em]">Additional services</div><ul className="mt-1.5 flex flex-col gap-1">{ADDITIONAL_SERVICES.map((item) => <Tick key={item} on={job.services.includes(item)} label={item} />)}</ul></div>
      </div></Box>
      <div className="mt-1 text-right text-[9px] font-bold uppercase tracking-[.08em] text-accent">Dimensions are in inches</div>

      <Box className="mt-1"><div className="grid grid-cols-[1.3fr_1fr] divide-x divide-[#0b3151]">
        <div><div className="form-band border-b border-[#0b3151] py-1 text-center text-[9.5px] font-bold uppercase tracking-[.1em]">Material description</div><dl className="grid grid-cols-2">{material.map(([label, value], index) => <div key={label} className={`flex border-b border-[#0b3151] ${index % 2 === 0 ? "border-r" : ""} [&:nth-last-child(-n+2)]:border-b-0`}><dt className="w-[52%] border-r border-[#0b3151] bg-[#fbf4ee] px-2 py-1 text-[9.5px] font-bold uppercase">{label}</dt><dd className="tally-mono px-2 py-1 font-medium text-navy">{value}</dd></div>)}</dl></div>
        <div><div className="form-band border-b border-[#0b3151] py-1 text-center text-[9.5px] font-bold uppercase tracking-[.1em]">Remark</div><p className="px-3 py-2">{spec.sample ? "Acceptance limits on this demo report are sample values, not DS-1." : `Tool joints checked against ${job.standard}, used tool joint acceptance criteria.`} Remaining wall checked against 80% of nominal for Premium.</p></div>
      </div></Box>

      <Box className="mt-2"><table className="w-full border-collapse text-center">
        <thead><tr className="form-band text-[9.5px] font-bold uppercase"><th rowSpan={2} className="border-b border-r border-[#0b3151] px-2 py-1 text-left">Results</th><th rowSpan={2} className="border-b border-r border-[#0b3151] px-2">No.</th><th colSpan={4} className="border-b border-r border-[#0b3151] py-0.5">Rework required</th><th colSpan={3} className="border-b border-[#0b3151] py-0.5">Field repaired</th></tr>
          <tr className="bg-[#fbf4ee] text-[8.5px] font-bold uppercase">{["Box conn", "Pin conn", "Pin & box", "Other", "Box conn", "Pin conn", "Other"].map((label, index) => <th key={index} className={`border-b border-[#0b3151] px-1 py-0.5 ${index === 3 ? "border-r" : ""}`}>{label}</th>)}</tr></thead>
        <tbody>{summary.rows.map((row, index) => { const cell = (value: number, edge = false) => <td className={`tally-mono border-b border-[#d6dee5] px-1 py-0.5 ${edge ? "border-r border-r-[#0b3151]" : ""}`}>{value || ""}</td>; return <tr key={row.label} className={index === 0 ? "font-bold" : ""}><td className="border-b border-r border-[#0b3151] px-2 py-0.5 text-left text-[10px] font-bold uppercase">{row.label}{index === 0 && ":"}</td><td className={`tally-mono border-b border-r border-[#0b3151] px-2 py-0.5 font-bold ${CLASS_TONE[row.label as FinalClass] ?? "text-navy"}`}>{row.count}</td>{cell(row.rework.box)}{cell(row.rework.pin)}{cell(row.rework.both)}{cell(row.rework.other, true)}{cell(row.repaired.box)}{cell(row.repaired.pin)}{cell(row.repaired.other)}</tr>; })}</tbody>
      </table></Box>
      {summary.pending > 0 && <p className="mt-1 font-semibold text-[#8a5d00]">{summary.pending} pipe{summary.pending === 1 ? " is" : "s are"} not graded yet; the totals cover the rest.</p>}

      <Box className="mt-2" title="Down graded pipes"><ul className="min-h-8 px-3 py-2">{summary.downgraded.length ? summary.downgraded.map(({ joint, graded }) => <li key={joint.no} className="flex gap-3 py-0.5"><span className="tally-mono w-20 shrink-0 font-semibold text-navy">{joint.serial ?? `Pipe ${joint.no}`}</span><span className={`w-28 shrink-0 font-bold ${CLASS_TONE[graded.final]}`}>{graded.final}</span><span className="text-slate-600">{reasons(graded).join("; ") || "Inspector's call"}</span></li>) : <li className="text-slate-500">None.</li>}</ul></Box>
      <Box className="mt-2" title="Comments"><p className="min-h-8 whitespace-pre-wrap px-3 py-1.5">{inspection.notes.trim() || "None."}</p></Box>

      <Box className="mt-2" title="Equipment details"><div className="grid grid-cols-3">{equipment.map((item, index) => <dl key={item.id} className={`border-b border-[#d6dee5] px-2 py-1.5 ${index % 3 !== 2 ? "border-r border-r-[#d6dee5]" : ""}`}><dt className="text-[9.5px] font-bold uppercase text-navy">{item.kind}</dt><dd className="tally-mono text-[10px] text-slate-600">Model {item.model} · S/N {item.serial}</dd><dd className="tally-mono text-[10px] text-slate-600">Cal. due {formatDate(item.calibrationDue)}</dd></dl>)}{!equipment.length && <p className="col-span-3 px-3 py-2 text-slate-500">No instruments listed.</p>}</div></Box>

      <div className="mt-4 flex break-inside-avoid items-end gap-6">
        {qr && <div className="shrink-0 text-center"><img src={qr} alt="Report verification QR" className="mx-auto size-24" /><div className="text-[9px] font-bold uppercase tracking-[.1em] text-slate-500">Scan to verify</div></div>}
        <div className="grid flex-1 grid-cols-3 gap-6"><Signature label="Customer signature" name="" /><Signature label="Inspector name & signature" name={inspection.inspector} date={inspection.submittedAt} image={inspection.signature} /><Signature label="Approved by" name={certificate ? "Authorised reviewer" : "Awaiting approval"} date={certificate ? inspection.reviewedAt : undefined} /></div>
      </div>
      <footer className="mt-4 flex justify-between border-t border-[#0b3151] pt-1.5 text-[9px] text-slate-500"><span>Laid out as F.581 · filled in by KTrack from tally sheet F.582 · demo report, fictional job{spec.sample ? ", sample limits" : ""}</span><span>Page 1 of 2</span></footer>
    </div>

    <div className="tally-page mt-8 border-[3px] border-[#0b3151] p-4">
      <header className="flex items-end justify-between"><div><div className="text-sm font-black uppercase tracking-[.08em] text-navy">{AMS_NAME}</div><div className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-600">Drill pipe inspection tally sheet</div></div><div className="tally-mono text-right text-[10px] text-slate-600">{record.assetRef} · {record.owner} · {record.site} · well {job.well || "–"}<br />{spec.size}&quot; {spec.weight} lb/ft · {spec.grade} · {spec.connection} · {job.range} · nom. wall {inches(job.nominalWall)}</div></header>
      <table className="mt-2 w-full border-collapse text-[7.5px] leading-tight">
        <thead>
          <tr className="form-band font-bold uppercase"><th rowSpan={2} className="border border-[#0b3151] px-0.5 py-0.5 text-left">ID no.</th>{GROUPS.map((group) => <th key={group} colSpan={TALLY_COLUMNS.filter((column) => column.group === group).length} className="border border-[#0b3151] py-0.5">{group}</th>)}</tr>
          <tr className="bg-[#fbf4ee] align-bottom font-bold">{TALLY_COLUMNS.map((column) => <th key={column.key} className="border border-[#0b3151] px-0.5 py-0.5">{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {joints.map((joint) => { const graded = gradePipe(spec, job, joint); return <tr key={joint.no} className="break-inside-avoid"><td className="tally-mono border border-[#b9c6d0] px-0.5">{joint.serial ?? joint.no}</td>{TALLY_COLUMNS.map((column, index) => {
            const value = column.kind === "number" ? joint.values[column.key] : undefined;
            const failed = column.kind === "number" && limitFailure(column, limits[index], value);
            const text = column.kind === "number" ? value === undefined ? "" : readingText(column, value) : column.kind === "code" ? joint.codes[column.key] ?? "OK" : column.kind === "coating" ? String(joint.coating ?? "") : graded.final === "Pending" ? "" : graded.final;
            const flagged = failed || (column.kind === "code" && joint.codes[column.key] && joint.codes[column.key] !== "OK");
            return <td key={column.key} className={`tally-mono border border-[#b9c6d0] px-0.5 text-right ${flagged ? "font-bold text-danger" : ""} ${column.kind === "class" ? `whitespace-nowrap text-left font-bold ${CLASS_TONE[graded.final]}` : ""}`}>{text}</td>;
          })}</tr>; })}
          <tr className="form-limits font-semibold"><td className="border border-[#0b3151] px-0.5 text-[7px] uppercase">Required / limit</td>{TALLY_COLUMNS.map((column, index) => <td key={column.key} className="tally-mono border border-[#0b3151] px-0.5 text-right">{limits[index] ? limitText(limits[index]!).replace(" to ", "–") : ""}</td>)}</tr>
        </tbody>
      </table>
      <p className="mt-1.5 text-[7.5px] text-slate-600"><b>ID coating:</b> 1 intact; 2 over 80% overall, over 75% localised; 3 65 to 80% overall, 50 to 75% localised; 4 under 65% overall, under 50% localised. <b>Codes:</b> {Object.entries(CODES).filter(([code]) => code !== "OK").map(([code, meaning]) => `${code} ${meaning.toLowerCase()}`).join(", ")}.</p>
      <footer className="mt-2 flex justify-between border-t border-[#0b3151] pt-1 text-[8px] text-slate-500"><span>Laid out as F.582 · {joints.length} pipes</span><span>Page 2 of 2</span></footer>
    </div>
  </div>;
}

// Print preview for one tally sheet's report; Print / Save PDF prints only this dialog (see .certificate-print-area in globals.css).
export function TallyReportDialog({ inspectionId, qr, onClose }: { inspectionId: string; qr?: string; onClose: () => void }) {
  const { state } = useApp();
  const dialog = useRef<HTMLDialogElement>(null);
  const inspection = state.inspections.find((item) => item.id === inspectionId);
  const record = state.records.find((item) => item.id === inspection?.assetId);
  const certificate = record?.certificates.find((item) => item.id === inspection?.certificateId);
  // A submitted sheet keeps the instruments as they were checked; a draft shows the register as it stands.
  const equipment = inspection?.job?.equipment ?? (state.equipment ?? []).filter((item) => inspection?.job?.equipmentIds.includes(item.id));
  useEffect(() => { dialog.current?.showModal(); }, []);
  if (!inspection || !record) return null;
  return createPortal(<><dialog ref={dialog} aria-label={`${record.assetRef} inspection report`} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }} className="certificate-print-area animate-rise fixed inset-0 m-auto max-h-[95vh] w-[min(95vw,1000px)] overflow-auto bg-white p-5 backdrop:bg-black/50 sm:p-8">
    <div className="print-hidden mb-4 flex justify-end gap-2"><Button className="press" onClick={() => window.print()}><Printer data-icon="inline-start" />Print / Save PDF</Button><Button variant="outline" onClick={() => dialog.current?.close()}>Close</Button></div>
    <TallyReport inspection={inspection} record={record} certificate={certificate} equipment={equipment} qr={qr} />
  </dialog>
  {/* The print copy: a modal dialog sits in the top layer, where Chrome ignores named pages, so the tally page would print portrait. */}
  <div className="tally-print-copy"><TallyReport inspection={inspection} record={record} certificate={certificate} equipment={equipment} qr={qr} /></div>
  </>, document.body);
}
