"use client";

import { useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { ArrowRight, Check, ClipboardList, FileText, Plus, Send, ShieldCheck, Trash2, X } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { RollingNumber } from "@/components/interior/value-flash";
import { TallyReportDialog } from "@/components/tally-report";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createTally, TALLY_TITLE } from "@/lib/ams";
import { deleteInspection, submitInspection, updateInspection } from "@/lib/domain";
import { connectionLabel, failureText, gradeJoint, inches, limitFailure, limitText, summarizeTally, type Grade } from "@/lib/tally";
import type { AppState, Inspection, InspectionStatus, Joint } from "@/lib/types";

const STATUS_BADGE: Record<InspectionStatus, "warning" | "success" | "danger" | "outline"> = { Draft: "outline", Submitted: "warning", Returned: "danger", Approved: "success", Issued: "success" };
const GRADE_BADGE: Record<Grade, "success" | "danger" | "outline"> = { Premium: "success", Reject: "danger", Pending: "outline" };

function nextJobNo(state: AppState): string {
  const year = state.demoDate.slice(0, 4);
  const last = Math.max(0, ...state.records.map((record) => Number(new RegExp(`^JOB-${year}-(\\d+)$`).exec(record.assetRef)?.[1] ?? 0)));
  return `JOB-${year}-${String(last + 1).padStart(4, "0")}`;
}

// A typed reading: blank clears it, anything else must be a positive number of inches. Excel pastes "6,19" in some locales.
function parseReading(text: string): number | null | undefined {
  const trimmed = text.trim().replace(",", ".");
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 && value < 100 ? Math.round(value * 1000) / 1000 : undefined;
}

function NewTally({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const { state, update } = useApp();
  const connections = state.connections ?? [];
  const [form, setForm] = useState({ jobNo: nextJobNo(state), customer: "Sample Drilling Co.", rig: "", connectionId: connections[0]?.id ?? "", joints: "20", inspector: "Omar Saeed" });
  const [error, setError] = useState("");
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [field]: event.target.value }));
  function create() {
    try {
      const result = createTally(state, { ...form, joints: Number(form.joints) });
      if (update(() => result.state)) onCreated(result.inspection.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The tally sheet could not be created."); }
  }
  const field = (id: keyof typeof form, label: string, props: Record<string, unknown> = {}) => <div><label className="eyebrow" htmlFor={`tally-${id}`}>{label}</label><Input id={`tally-${id}`} className="mt-1.5" value={form[id]} onChange={set(id)} {...props} /></div>;
  return <div className="animate-rise mt-4 rounded-xl border border-[#b8cedc] bg-[#f6fafc] p-4">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="sm:col-span-2"><label className="eyebrow" htmlFor="tally-format">Report format</label><Select id="tally-format" className="mt-1.5" defaultValue="tool-joint"><option value="tool-joint">{TALLY_TITLE}</option><option disabled>Your other 30 to 35 report formats</option></Select></div>
      <div className="sm:col-span-2"><label className="eyebrow" htmlFor="tally-connection">Connection</label><Select id="tally-connection" className="mt-1.5" value={form.connectionId} onChange={set("connectionId")}>{connections.length ? connections.map((spec) => <option key={spec.id} value={spec.id}>{connectionLabel(spec)}{spec.sample ? " · sample limits" : ""}</option>) : <option value="">Import a dimension table first</option>}</Select></div>
      {field("jobNo", "Job number")}
      {field("customer", "Customer")}
      {field("rig", "Rig or yard", { placeholder: "Rig SD-09" })}
      <div className="grid grid-cols-2 gap-3">{field("joints", "Joints", { type: "number", min: 1, max: 500 })}{field("inspector", "Inspector")}</div>
    </div>
    {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
    <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button onClick={create} disabled={!connections.length}><Plus data-icon="inline-start" />Open tally sheet</Button></div>
  </div>;
}

// One row per joint, one column per limit in the connection's table. Tab moves across, Enter moves down, and a block
// pasted from Excel fills from the cell it lands in. A reading outside its limit turns red and the joint is rejected on the spot.
function TallyGrid({ inspection, disabled, onChange }: { inspection: Inspection; disabled: boolean; onChange: (change: (joints: Joint[]) => Joint[]) => void }) {
  const spec = inspection.connection!;
  const joints = inspection.joints ?? [];
  const columns = ["Serial", ...spec.limits.map((limit) => limit.column)];
  const focusCell = (row: number, column: number) => document.querySelector<HTMLInputElement>(`[data-tally-cell="${row}:${column}"]`)?.select();

  function write(row: number, column: number, text: string) {
    onChange((current) => current.map((joint, index) => {
      if (index !== row) return joint;
      if (column === 0) return { ...joint, serial: text.trim() || undefined };
      const reading = parseReading(text);
      if (reading === undefined) return joint;
      const values = { ...joint.values };
      if (reading === null) delete values[columns[column]]; else values[columns[column]] = reading;
      return { ...joint, values };
    }));
  }
  function paste(event: ClipboardEvent<HTMLInputElement>, row: number, column: number) {
    const text = event.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.trim())) return;
    event.preventDefault();
    const block = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((line) => line.split("\t"));
    onChange((current) => current.map((joint, index) => {
      const cells = block[index - row];
      if (!cells) return joint;
      let next = joint;
      cells.forEach((cell, offset) => {
        const at = column + offset;
        if (at === 0) next = { ...next, serial: cell.trim() || undefined };
        else if (at < columns.length) { const reading = parseReading(cell); if (reading !== undefined) { const values = { ...next.values }; if (reading === null) delete values[columns[at]]; else values[columns[at]] = reading; next = { ...next, values }; } }
      });
      return next;
    }));
  }
  function key(event: KeyboardEvent<HTMLInputElement>, row: number, column: number) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.blur();
    focusCell(row + (event.shiftKey ? -1 : 1), column);
  }
  const setVisual = (row: number, visual: Joint["visual"]) => onChange((current) => current.map((joint, index) => index === row ? { ...joint, visual: joint.visual === visual ? "pending" : visual } : joint));

  return <div className="overflow-x-auto rounded-xl border border-line">
    <table className="w-full border-collapse text-sm">
      <thead className="bg-paper"><tr className="text-left align-bottom text-[11px] font-bold text-navy">
        <th className="sticky left-0 z-10 bg-paper px-3 py-2">Joint</th>
        {columns.map((column, index) => <th key={column} className={`px-1 py-2 ${index ? "text-right" : ""}`}>{column}{index > 0 && <div className="font-mono text-[10px] font-normal text-slate-500">{limitText(spec.limits[index - 1])}</div>}</th>)}
        <th className="px-2 py-2">Visual</th><th className="px-3 py-2">Grade</th>
      </tr></thead>
      <tbody>{joints.map((joint, row) => {
        const { grade, failures } = gradeJoint(spec, joint);
        return <tr key={joint.no} className={`border-t border-line ${grade === "Reject" ? "bg-[#fff6f6]" : ""}`}>
          <td className={`sticky left-0 z-10 px-3 py-1 font-mono text-xs font-semibold text-slate-500 ${grade === "Reject" ? "bg-[#fff6f6]" : "bg-white"}`}>{joint.no}</td>
          {columns.map((column, index) => {
            const value = index ? joint.values[column] : undefined;
            const failure = index ? limitFailure(spec.limits[index - 1], value) : undefined;
            const shown = index ? (value === undefined ? "" : inches(value)) : joint.serial ?? "";
            // Keyed by the stored value, so a paste or a rejected entry redraws the cell with what was saved.
            return <td key={column} className="px-0.5 py-1"><input key={shown} data-tally-cell={`${row}:${index}`} defaultValue={shown} disabled={disabled} inputMode={index ? "decimal" : "text"} aria-label={`Joint ${joint.no} ${column}`} aria-invalid={Boolean(failure)} title={failure ? failureText(failure) : undefined}
              onBlur={(event) => { if (event.currentTarget.value !== shown) write(row, index, event.currentTarget.value); }} onKeyDown={(event) => key(event, row, index)} onPaste={(event) => paste(event, row, index)}
              className={`focus-ring h-8 rounded-md border px-1.5 font-mono text-[12.5px] tabular-nums transition-colors disabled:bg-transparent ${index ? "w-[70px] text-right" : "w-[84px]"} ${failure ? "border-danger bg-[#fde8e8] font-bold text-danger" : "border-line bg-white text-navy"}`} /></td>;
          })}
          <td className="px-2 py-1"><div className="flex gap-1">{(["pass", "fail"] as const).map((visual) => <button key={visual} type="button" disabled={disabled} aria-pressed={joint.visual === visual} aria-label={`Joint ${joint.no} visual ${visual}`} onClick={() => setVisual(row, visual)}
            className={`focus-ring h-8 rounded-md border px-1.5 text-xs font-semibold transition-[transform,background-color] active:scale-[.96] disabled:active:scale-100 ${joint.visual === visual ? visual === "pass" ? "border-success bg-success text-white" : "border-danger bg-danger text-white" : "border-line bg-white text-slate-500 hover:bg-paper"}`}>{visual === "pass" ? "Pass" : "Fail"}</button>)}</div></td>
          <td className="px-3 py-1"><Badge variant={GRADE_BADGE[grade]}>{grade}</Badge>{grade === "Reject" && <div className="mt-0.5 max-w-[150px] text-[11px] leading-tight text-danger">{[...failures.map(failureText), ...(joint.visual === "fail" ? ["Visual check failed"] : [])].join("; ")}</div>}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

export function TallyView() {
  const { state, update } = useApp();
  const tallies = state.inspections.filter((inspection) => inspection.joints);
  const [selectedId, setSelectedId] = useState<string | undefined>(() => (tallies.find((item) => item.status === "Draft" || item.status === "Returned") ?? tallies[0])?.id);
  const [creating, setCreating] = useState(false);
  const [report, setReport] = useState(false);
  const selected = tallies.find((item) => item.id === selectedId);
  const record = state.records.find((item) => item.id === selected?.assetId);
  const certificate = record?.certificates.find((item) => item.id === selected?.certificateId);
  const canWork = state.role === "Admin" || state.role === "Engineer";
  const canEdit = canWork && (selected?.status === "Draft" || selected?.status === "Returned");
  const summary = selected?.connection ? summarizeTally(selected.connection, selected.joints ?? []) : undefined;

  const changeJoints = (change: (joints: Joint[]) => Joint[]) => { if (selected) update((current) => { const item = current.inspections.find((inspection) => inspection.id === selected.id); return item?.joints ? updateInspection(current, item.id, { joints: change(item.joints) }) : current; }); };
  const saveNotes = (notes: string) => { if (selected) update((current) => updateInspection(current, selected.id, { notes })); };
  function submit() { if (selected) flushSync(() => update((current) => submitInspection(current, selected.id))); }
  function removeDraft() {
    if (!selected || !window.confirm(`Delete the draft tally sheet for ${record?.assetRef ?? "this job"}? This cannot be undone.`)) return;
    if (update((current) => deleteInspection(current, selected.id))) setSelectedId(undefined);
  }

  return <div className="flex flex-col gap-5">
    <Card><CardHeader className="flex-row items-start justify-between gap-3"><div><div className="eyebrow">Jobs</div><CardTitle>{tallies.length} tally sheet{tallies.length === 1 ? "" : "s"}</CardTitle></div>{canWork && !creating && <Button onClick={() => setCreating(true)}><Plus data-icon="inline-start" />New tally sheet</Button>}</CardHeader>
      <CardContent>
        {tallies.length ? <div className="flex flex-col gap-1">{tallies.map((inspection) => {
          const job = state.records.find((item) => item.id === inspection.assetId);
          const counts = summarizeTally(inspection.connection!, inspection.joints ?? []);
          return <button key={inspection.id} type="button" onClick={() => setSelectedId(inspection.id)} className={`focus-ring grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-lg px-3 py-2.5 text-left text-sm sm:grid-cols-[150px_1fr_160px_110px] ${inspection.id === selectedId ? "bg-[#e8f3f8]" : "hover:bg-paper"}`}>
            <span className="font-semibold text-navy">{job?.assetRef ?? "Unknown job"}</span>
            <span className="hidden truncate text-slate-600 sm:block">{job?.owner} · {job?.site} · {inspection.connection && connectionLabel(inspection.connection)}</span>
            <span className="hidden text-xs tabular-nums text-slate-500 sm:block">{counts.total - counts.pending} of {counts.total} graded{counts.reject ? ` · ${counts.reject} reject` : ""}</span>
            <Badge className="justify-self-end" variant={STATUS_BADGE[inspection.status]}>{inspection.status}</Badge>
          </button>;
        })}</div> : <p className="text-sm text-slate-500">No tally sheets yet. Open one for a job to start measuring.</p>}
        {creating && <NewTally onCreated={(id) => { setSelectedId(id); setCreating(false); }} onCancel={() => setCreating(false)} />}
        {!canWork && <p className="mt-3 text-xs text-slate-500">Switch to Engineer or Admin to open or fill in a tally sheet.</p>}
      </CardContent>
    </Card>

    {selected && record && summary ? <Card>
      <CardHeader className="border-b border-line">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">{record.assetRef} · {record.owner} · {record.site}</div><CardTitle className="mt-1">{selected.title ?? TALLY_TITLE}</CardTitle><p className="mt-1 text-sm text-slate-500">{connectionLabel(selected.connection!)}{selected.connection!.sample && " · sample limits, not DS-1 values"} · Inspector: {selected.inspector}</p></div><Badge variant={STATUS_BADGE[selected.status]}>{selected.status}</Badge></div>
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{([["Joints", summary.total, "text-navy"], ["Premium", summary.premium, "text-success"], ["Reject", summary.reject, summary.reject ? "text-danger" : "text-navy"], ["To measure", summary.pending, summary.pending ? "text-[#8a5d00]" : "text-navy"]] as const).map(([label, value, tone]) => <div key={label} className="rounded-lg border border-line px-3 py-2"><dt className="eyebrow">{label}</dt><dd className={`mt-0.5 text-2xl font-bold tabular-nums ${tone}`}><RollingNumber value={value} /></dd></div>)}</dl>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 p-5">
        <TallyGrid key={selected.id} inspection={selected} disabled={!canEdit} onChange={changeJoints} />
        {canEdit && <p className="-mt-2 text-xs text-slate-500">Tab moves across, Enter moves down. Paste a block of cells from Excel and it fills from the cell you paste into. Out-of-limit readings turn red and reject the joint.</p>}
        <div><label className="eyebrow" htmlFor="tally-notes">Comments</label><Textarea id="tally-notes" className="mt-1.5" defaultValue={selected.notes} key={selected.id} disabled={!canEdit} onBlur={(event) => { if (event.currentTarget.value !== selected.notes) saveNotes(event.currentTarget.value); }} placeholder="Gauges used, conditions, anything the reviewer should know…" /></div>
        {selected.reviewerComment && selected.status === "Returned" && <div className="flex gap-2 rounded-lg border border-[#f0c2c3] bg-[#fff6f6] px-3 py-3 text-sm text-danger"><X className="mt-0.5 size-4 shrink-0" /><span><strong>Returned for correction.</strong> {selected.reviewerComment}</span></div>}
        <div className="border-t border-line pt-4" aria-live="polite">{selected.status === "Submitted" ? <div className="animate-rise flex flex-wrap items-center gap-3 rounded-lg border border-success/25 bg-success/[.06] px-4 py-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-success text-white"><Check className="draw-check size-5" strokeWidth={3} aria-hidden="true" /></span><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-navy">Sent for review</div><div className="text-xs text-slate-600">The summary report is ready. A reviewer approves it in Approvals, and it is issued with a number and a QR code.</div></div><Button variant="outline" size="sm" onClick={() => setReport(true)}><FileText data-icon="inline-start" />Preview report</Button><Button asChild size="sm"><Link href="/approvals">Open Approvals<ArrowRight data-icon="inline-end" /></Link></Button></div>
          : selected.status === "Issued" ? <div className="animate-rise flex flex-wrap items-center gap-3 rounded-lg border border-success/25 bg-success/[.06] px-4 py-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-success text-white"><ShieldCheck className="size-5" aria-hidden="true" /></span><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-navy">Report issued{certificate && ` · ${certificate.number}`}</div><div className="text-xs text-slate-600">Print it or show its QR code from Reports.</div></div><Button variant="outline" size="sm" onClick={() => setReport(true)}><FileText data-icon="inline-start" />View report</Button><Button asChild size="sm"><Link href="/certificates">Open Reports<ArrowRight data-icon="inline-end" /></Link></Button></div>
          : <div className="flex flex-wrap items-center justify-end gap-2">{selected.status === "Draft" && canWork && <Button variant="ghost" className="mr-auto text-danger hover:bg-[#fff3f3]" onClick={removeDraft}><Trash2 data-icon="inline-start" />Delete draft</Button>}{summary.pending > 0 && <span className="text-xs text-slate-500">{summary.pending} joint{summary.pending === 1 ? "" : "s"} still to measure</span>}<Button variant="outline" onClick={() => setReport(true)}><FileText data-icon="inline-start" />Preview report</Button><Button onClick={submit} disabled={!canEdit || summary.pending > 0}><Send data-icon="inline-start" />Submit for review</Button></div>}</div>
      </CardContent>
    </Card> : <Card><CardContent className="flex min-h-[320px] flex-col items-center justify-center p-8 text-center"><ClipboardList className="size-10 text-[#b8cedc]" /><h2 className="mt-4 font-semibold text-navy">Open a tally sheet</h2><p className="mt-2 max-w-sm text-sm text-slate-500">Choose a job above, or open a new tally sheet for a string. Each joint is checked against the connection&apos;s dimension table as you type.</p></CardContent></Card>}
    {report && selected && <TallyReportDialog inspectionId={selected.id} onClose={() => setReport(false)} />}
  </div>;
}
