"use client";

import { useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, ChevronRight, ClipboardList, FileText, Plus, Send, ShieldCheck, Trash2, X } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { RollingNumber } from "@/components/interior/value-flash";
import { OUTCOME_TONE, TallyReportDialog } from "@/components/tally-report";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ADDITIONAL_SERVICES, createTally, INSPECTION_PROGRAM, TALLY_TITLE } from "@/lib/ams";
import { deleteInspection, submitInspection, updateInspection } from "@/lib/domain";
import { calibrationStatus, class2Text, CODES, connectionLabel, expiredEquipment, FINAL_CLASSES, gradePipe, inches, limitFailure, limitFor, limitText, readingText, reasons, SAMPLE_CRITERIA, summarizeTally, TALLY_COLUMNS, type Group, type TallyColumn } from "@/lib/tally";
import type { AppState, FinalClass, Inspection, InspectionStatus, Joint, TallyJob } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const STATUS_BADGE: Record<InspectionStatus, "warning" | "success" | "danger" | "outline"> = { Draft: "outline", Submitted: "warning", Returned: "danger", Approved: "success", Issued: "success" };
const GROUPS: Group[] = ["Pipe body", "Box tool joint", "Pin tool joint"];

function nextWorkOrder(state: AppState): string {
  const year = state.demoDate.slice(0, 4);
  const last = Math.max(0, ...state.records.map((record) => Number(new RegExp(`^WO-${year}-(\\d+)$`).exec(record.assetRef)?.[1] ?? 0)));
  return `WO-${year}-${String(last + 1).padStart(4, "0")}`;
}

// One typed or pasted cell. A blank clears it; anything that doesn't read as that column's kind leaves the pipe as it was.
function applyCell(joint: Joint, cell: TallyColumn | "serial", text: string): Joint {
  const value = text.trim();
  if (cell === "serial") return { ...joint, serial: value || undefined };
  if (cell.kind === "number") {
    const values = { ...joint.values };
    if (!value) { delete values[cell.key]; return { ...joint, values }; }
    const number = Number(value.replace(",", "."));
    return Number.isFinite(number) && number >= 0 && number < 100 ? { ...joint, values: { ...values, [cell.key]: Math.round(number * 1000) / 1000 } } : joint;
  }
  if (cell.kind === "code") {
    const code = value.toUpperCase();
    if (code && !(code in CODES)) return joint;
    const codes = { ...joint.codes };
    if (!code || code === "OK") delete codes[cell.key]; else codes[cell.key] = code;
    return { ...joint, codes };
  }
  if (cell.kind === "coating") return [1, 2, 3, 4].includes(Number(value)) ? { ...joint, coating: Number(value) } : value ? joint : { ...joint, coating: undefined };
  const finalClass = FINAL_CLASSES.find((item) => item.toLowerCase() === value.toLowerCase()) ?? (value.toUpperCase() === "P" ? "Premium-Accepted" : undefined);
  return value && !finalClass ? joint : { ...joint, finalClass };
}

function NewTally({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const { state, update } = useApp();
  const connections = state.connections ?? [];
  const [form, setForm] = useState({ jobNo: nextWorkOrder(state), customer: "Sample Drilling Co.", rig: "", well: "", location: "Musaffah yard", connectionId: connections[0]?.id ?? "", joints: "20", range: "R2", nominalWall: "0.362", serviceCategory: "Category 4", inspector: "Omar Saeed" });
  const [error, setError] = useState("");
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [field]: event.target.value }));
  function create() {
    try {
      const result = createTally(state, { ...form, joints: Number(form.joints), nominalWall: Number(form.nominalWall) });
      if (update(() => result.state)) onCreated(result.inspection.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The tally sheet could not be opened."); }
  }
  // A 12-column grid: the two pickers take half each, the job fields a quarter, and the six short fields a sixth, so no label wraps.
  const field = (id: keyof typeof form, label: string, span: string, props: Record<string, unknown> = {}) => <div className={span}><label className="eyebrow" htmlFor={`tally-${id}`}>{label}</label><Input id={`tally-${id}`} className="mt-1.5" value={form[id]} onChange={set(id)} {...props} /></div>;
  const pick = (id: keyof typeof form, label: string, span: string, options: string[]) => <div className={span}><label className="eyebrow" htmlFor={`tally-${id}`}>{label}</label><Select id={`tally-${id}`} className="mt-1.5" value={form[id]} onChange={set(id)}>{options.map((option) => <option key={option}>{option}</option>)}</Select></div>;
  return <div className="animate-rise mt-4 rounded-xl border border-[#e9c9ae] bg-[#fffaf5] p-4">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-12">
      <div className="sm:col-span-2 xl:col-span-6"><label className="eyebrow" htmlFor="tally-format">Report format</label><Select id="tally-format" className="mt-1.5" defaultValue="f582"><option value="f582">F.582 drill pipe tally sheet → F.581 summary report</option><option disabled>Your other report formats</option></Select></div>
      <div className="sm:col-span-2 xl:col-span-6"><label className="eyebrow" htmlFor="tally-connectionId">Pipe and thread connection</label><Select id="tally-connectionId" className="mt-1.5" value={form.connectionId} onChange={set("connectionId")}>{connections.length ? connections.map((spec) => <option key={spec.id} value={spec.id}>{connectionLabel(spec)}{spec.sample ? " · sample limits" : ""}</option>) : <option value="">Import a dimension table first</option>}</Select></div>
      {field("jobNo", "Work order", "xl:col-span-3")}
      {field("customer", "Customer", "xl:col-span-3")}
      {field("rig", "Rig", "xl:col-span-3", { placeholder: "Rig SD-09" })}
      {field("well", "Well no.", "xl:col-span-3", { placeholder: "SD-09-01" })}
      {field("location", "Location", "xl:col-span-2")}
      {field("joints", "Pipes", "xl:col-span-2", { type: "number", min: 1, max: 500 })}
      {pick("range", "Range", "xl:col-span-2", ["R1", "R2", "R3"])}
      {field("nominalWall", "Nom. wall (in)", "xl:col-span-2", { inputMode: "decimal" })}
      {pick("serviceCategory", "Service cat.", "xl:col-span-2", ["Category 1", "Category 2", "Category 3", "Category 4", "Category 5"])}
      {field("inspector", "Inspector", "xl:col-span-2")}
    </div>
    {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
    <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button className="press" onClick={create} disabled={!connections.length}><Plus data-icon="inline-start" />Open tally sheet</Button></div>
  </div>;
}

// The F.582 header block, read back from the job: the same labels in the same order as the paper sheet.
function FormHeader({ inspection, customer, rig, reportNo, date }: { inspection: Inspection; customer: string; rig: string; reportNo?: string; date: string }) {
  const spec = inspection.connection!;
  const job = inspection.job!;
  const cells: [string, string][] = [["Customer", customer], ["Rig", rig], ["Well no.", job.well || "–"], ["Ref. report no.", reportNo ?? "On issue"], ["Date", formatDate(date)], ["Pipe OD", `${spec.size}"`], ["Grade", spec.grade], ["Range", job.range], ["Weight lb/ft", spec.weight], ["Nom. wall", `${inches(job.nominalWall)}"`], ["Thread connection", spec.connection], ["Inspection standard", job.standard], ["Service category", job.serviceCategory]];
  return <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-[#e9c9ae] sm:grid-cols-4 xl:grid-cols-7">{cells.map(([label, value]) => <div key={label} className="-mb-px -mr-px border-b border-r border-[#f0dccb] px-3 py-2"><dt className="text-[10px] font-bold uppercase tracking-[.08em] text-[#8a4a1c]">{label}</dt><dd className="mt-0.5 text-sm font-semibold text-navy">{value}</dd></div>)}</dl>;
}

// Everything F.581 asks for that isn't on the tally: the inspection programme, extra services, material description and the
// instruments used. Editable while the sheet is a draft; the report reads it from here.
function ReportDetails({ inspection, disabled, onChange }: { inspection: Inspection; disabled: boolean; onChange: (patch: Partial<TallyJob>) => void }) {
  const { state } = useApp();
  const job = inspection.job!;
  const toggle = (list: string[], item: string) => list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
  const chips = (label: string, options: string[], selected: string[], field: "program" | "services") => <fieldset><legend className="eyebrow">{label}</legend><div className="mt-2 flex flex-wrap gap-1.5">{options.map((option) => { const on = selected.includes(option); return <button key={option} type="button" aria-pressed={on} disabled={disabled} onClick={() => onChange({ [field]: toggle(selected, option) })} className={`press focus-ring inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold disabled:cursor-default ${on ? "border-navy bg-navy text-white" : "border-line bg-white text-slate-600 [@media(hover:hover)]:hover:border-[#b8cedc]"}`}>{on && <Check className="size-3" strokeWidth={3} aria-hidden="true" />}{option}</button>; })}</div></fieldset>;
  const material = (field: "toolJointOd" | "pinId" | "hardBand", label: string) => <div><label className="eyebrow" htmlFor={`job-${field}`}>{label}</label><Input id={`job-${field}`} key={`${inspection.id}-${job[field] ?? ""}`} className="mt-1.5 h-9" defaultValue={job[field] ?? ""} disabled={disabled} onBlur={(event) => { if (event.currentTarget.value.trim() !== (job[field] ?? "")) onChange({ [field]: event.currentTarget.value.trim() || undefined }); }} /></div>;
  return <details className="group rounded-lg border border-line bg-[#fbfcfd]">
    <summary className="focus-ring flex cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-navy [&::-webkit-details-marker]:hidden"><ChevronRight className="size-4 text-slate-400 transition-transform duration-200 ease-out group-open:rotate-90" aria-hidden="true" />Report details<span className="font-normal text-slate-500">· {job.program.length} inspections, {job.services.length} services, {job.equipmentIds.length} instruments</span></summary>
    <div className="grid gap-5 border-t border-line px-4 py-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">{chips("Inspection program", INSPECTION_PROGRAM, job.program, "program")}{chips("Additional services", ADDITIONAL_SERVICES, job.services, "services")}<div className="grid grid-cols-3 gap-3">{material("toolJointOd", "Tool joint OD")}{material("pinId", "Pin ID")}{material("hardBand", "Hard band")}</div></div>
      <fieldset><legend className="eyebrow">Equipment used</legend><div className="mt-2 flex flex-col divide-y divide-line rounded-lg border border-line bg-white">{(state.equipment ?? []).map((item) => {
        const status = calibrationStatus(item, state.demoDate);
        return <label key={item.id} className="flex items-center gap-3 px-3 py-1.5 text-sm"><input type="checkbox" className="size-4 accent-[#0b3151]" checked={job.equipmentIds.includes(item.id)} disabled={disabled} onChange={() => onChange({ equipmentIds: toggle(job.equipmentIds, item.id) })} /><span className="min-w-0 flex-1 truncate"><span className="font-semibold text-navy">{item.kind}</span> <span className="text-slate-500">{item.model} · {item.serial}</span></span><span className={`tally-mono text-xs ${status === "Expired" ? "font-semibold text-danger" : status === "Due soon" ? "text-[#8a5d00]" : "text-slate-500"}`}>{status === "Expired" ? "expired " : "cal. due "}{formatDate(item.calibrationDue)}</span></label>;
      })}</div><Link href="/equipment" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">Manage instruments in Equipment<ArrowRight className="size-3" /></Link></fieldset>
    </div>
  </details>;
}

const CLASS_COLUMN = TALLY_COLUMNS.find((column) => column.kind === "class")!;
// The class sits pinned beside the pipe ID instead of inside the pipe body, so the result never scrolls out of view.
const GRID_COLUMNS = TALLY_COLUMNS.filter((column) => column !== CLASS_COLUMN);
const SHORT: Record<FinalClass | "Pending", string> = { "Class 1 (New)": "Class 1", "Class 1-Rework": "Class 1 rework", "Premium-Accepted": "Premium", "Premium-Rework": "Rework", "Class-2": "Class 2", Bent: "Bent", Scrap: "Scrap", Pending: "To measure" };
const CHIP: Record<FinalClass | "Pending", string> = {
  "Class 1 (New)": "text-success", "Premium-Accepted": "text-success", "Class 1-Rework": "bg-[#fff2d7] text-[#8a5d00]", "Premium-Rework": "bg-[#fff2d7] text-[#8a5d00]",
  "Class-2": "bg-[#ffeadb] text-[#b45309]", Bent: "bg-[#ffeadb] text-[#b45309]", Scrap: "bg-[#fde8e8] text-danger", Pending: "text-slate-400",
};

// The F.582 grid, kept as a spreadsheet because inspectors already work in F.582 and Excel: group bands, column names, the
// green limits row, then one row per pipe. Each pipe's result is pinned next to its ID with the reason, and the chip is where
// the inspector overrides KTrack's class. Tab moves across, Enter moves down, and a block pasted from Excel fills from the
// cell it lands in. Nothing here animates: it's driven by the keyboard.
function TallyGrid({ inspection, rows, disabled, onChange }: { inspection: Inspection; rows: number[] | undefined; disabled: boolean; onChange: (change: (joints: Joint[]) => Joint[]) => void }) {
  const spec = inspection.connection!;
  const job = inspection.job!;
  const joints = (inspection.joints ?? []).filter((joint) => !rows || rows.includes(joint.no));
  const order = joints.map((joint) => joint.no);
  const limits = GRID_COLUMNS.map((column) => limitFor(column, spec, job));
  const criteria = job.criteria ?? SAMPLE_CRITERIA;
  const write = (no: number, cell: TallyColumn | "serial", text: string) => onChange((current) => current.map((joint) => joint.no === no ? applyCell(joint, cell, text) : joint));
  // Pasted lines go to the rows on screen, so a filtered grid fills the pipes it shows.
  function paste(event: ClipboardEvent<HTMLInputElement>, no: number, cell: number) {
    const text = event.clipboardData.getData("text/plain");
    if (disabled || !/[\t\n]/.test(text.trim())) return;
    event.preventDefault();
    const block = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((line) => line.split("\t"));
    const start = order.indexOf(no);
    const cells: (TallyColumn | "serial")[] = ["serial", ...GRID_COLUMNS];
    onChange((current) => current.map((joint) => order.includes(joint.no) ? (block[order.indexOf(joint.no) - start] ?? []).reduce((next, value, offset) => cells[cell + offset] ? applyCell(next, cells[cell + offset], value) : next, joint) : joint));
  }
  function key(event: KeyboardEvent<HTMLInputElement>, cell: number) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const row = event.currentTarget.closest("tr");
    const next = (event.shiftKey ? row?.previousElementSibling : row?.nextElementSibling)?.querySelector<HTMLInputElement>(`input[data-col="${cell}"]`);
    event.currentTarget.blur();
    next?.select();
  }
  const groupEdge = (index: number) => GRID_COLUMNS[index + 1] && GRID_COLUMNS[index + 1].group !== GRID_COLUMNS[index].group;
  const cellInput = "tally-mono block h-8 bg-transparent px-2 text-[12.5px] outline-none placeholder:text-slate-300 focus:bg-white focus:outline-2 focus:-outline-offset-2 focus:outline-accent read-only:cursor-default";
  const pinned = "sticky z-10 border-b border-line";
  return <div className="isolate max-h-[68vh] overflow-auto rounded-xl border border-line bg-white">
    <datalist id="tally-codes">{Object.entries(CODES).filter(([code]) => code !== "OK").map(([code, meaning]) => <option key={code} value={code}>{meaning}</option>)}</datalist>
    <table className="border-separate border-spacing-0 text-sm">
      <thead className="sticky top-0 z-20">
        <tr className="text-[10px] font-bold uppercase tracking-[.1em]">
          <th rowSpan={2} className="form-band sticky left-0 z-10 w-[132px] min-w-[132px] border-b border-[#e9c9ae] px-3 py-2 text-left align-bottom">Pipe ID</th>
          <th rowSpan={2} className="form-band sticky left-[132px] z-10 w-[220px] min-w-[220px] border-b border-r border-[#e9c9ae] px-3 py-2 text-left align-bottom">Final class</th>
          {GROUPS.map((group) => <th key={group} colSpan={GRID_COLUMNS.filter((column) => column.group === group).length} className="form-band border-b border-r border-[#e9c9ae] px-2 py-1.5 text-center">{group}</th>)}
        </tr>
        <tr className="align-bottom text-[11px] font-bold leading-tight text-navy">{GRID_COLUMNS.map((column, index) => <th key={column.key} title={column.name} className={`border-b border-line bg-paper px-2 py-2 ${column.kind === "number" ? "text-right" : "text-center"} ${groupEdge(index) ? "border-r border-r-[#e9c9ae]" : ""}`}><span className="line-clamp-3 max-w-[80px]">{column.label}</span></th>)}</tr>
        <tr className="text-[10.5px]">
          <th colSpan={2} className="form-limits sticky left-0 z-10 border-b border-r border-[#c5e0ad] px-3 py-1.5 text-left font-semibold">Acceptable limit</th>
          {GRID_COLUMNS.map((column, index) => <th key={column.key} className={`form-limits tally-mono border-b border-[#c5e0ad] px-2 py-1.5 text-right font-medium ${groupEdge(index) ? "border-r" : ""}`}>{limits[index] ? limitText(limits[index]!).replace(" to ", "–") : ""}{limits[index] && class2Text(limits[index]!) && <span className="block text-[#b45309]" title="Class 2 limit">C2 {class2Text(limits[index]!).replace(" to ", "–")}</span>}</th>)}
        </tr>
      </thead>
      <tbody>{joints.map((joint) => {
        const graded = gradePipe(spec, job, joint);
        const tint = graded.final === "Scrap" ? "bg-[#fff8f8]" : graded.final === "Class-2" || graded.final === "Bent" ? "bg-[#fffaf3]" : "bg-white";
        const changed = joint.finalClass !== undefined && joint.finalClass !== graded.suggested;
        const why = reasons(graded);
        const missing = GRID_COLUMNS.filter((column, index) => column.kind === "number" && (column.required || limits[index]) && joint.values[column.key] === undefined).map((column) => column.name);
        const detail = changed ? `inspector's call · KTrack: ${SHORT[graded.suggested]}` : graded.final === "Pending" ? `needs ${missing[0]}${missing.length > 1 ? ` +${missing.length - 1}` : ""}` : why.length ? why[0] + (why.length > 1 ? ` +${why.length - 1}` : "") : graded.repaired ? `re-faced ${graded.repaired}` : "";
        const accepted = graded.final === "Premium-Accepted" || graded.final === "Class 1 (New)";
        return <tr key={joint.no} className={tint}>
          <td className={`${pinned} left-0 px-2 ${tint}`}><div className="flex items-center gap-1"><span className="tally-mono w-6 shrink-0 text-right text-[11px] text-slate-400">{joint.no}</span><input key={joint.serial ?? ""} data-col={0} defaultValue={joint.serial ?? ""} readOnly={disabled} aria-label={`Pipe ${joint.no} identification number`} onBlur={(event) => { if (event.currentTarget.value !== (joint.serial ?? "")) write(joint.no, "serial", event.currentTarget.value); }} onKeyDown={(event) => key(event, 0)} onPaste={(event) => paste(event, joint.no, 0)} className={`${cellInput} w-[92px] font-semibold text-navy`} /></div></td>
          <td className={`${pinned} left-[132px] border-r border-r-[#e9c9ae] px-2 ${tint}`}>
            <div className="relative flex h-8 max-w-[320px] items-center gap-2 rounded-md focus-within:outline-2 focus-within:outline-accent" title={[changed ? `Set by the inspector. KTrack suggested ${graded.suggested}.` : "", graded.final === "Pending" ? `Needs ${missing.join(", ")}` : "", ...why].filter(Boolean).join("\n") || undefined}>
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-full py-0.5 text-[11.5px] font-semibold ${accepted || graded.final === "Pending" ? "" : "px-2"} ${CHIP[graded.final]} ${changed ? "outline-1 outline-offset-1 outline-accent outline-dashed px-2" : ""}`}>{accepted && <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />}{SHORT[graded.final]}</span>
              <span className="min-w-0 truncate text-[11.5px] text-slate-500">{detail}</span>
              {!disabled && <select value={joint.finalClass ?? ""} aria-label={`Pipe ${joint.no} final class`} onChange={(event) => write(joint.no, CLASS_COLUMN, event.target.value)} className="absolute inset-0 cursor-pointer opacity-0"><option value="">{graded.suggested === "Pending" ? "To measure" : `KTrack's suggestion: ${graded.suggested}`}</option>{FINAL_CLASSES.map((item) => <option key={item} value={item}>{item}</option>)}</select>}
            </div>
          </td>
          {GRID_COLUMNS.map((column, index) => {
            const cell = index + 1;
            const label = `Pipe ${joint.no} ${column.name}`;
            const edge = groupEdge(index) ? "border-r border-r-[#f0dccb]" : "border-r border-r-[#f1f4f7]";
            if (column.kind === "number") {
              const value = joint.values[column.key];
              const shown = value === undefined ? "" : readingText(column, value);
              const failure = limitFailure(column, limits[index], value);
              // Keyed by the stored value, so a paste or a refused entry redraws the cell with what was saved.
              return <td key={column.key} className={`border-b border-line p-0 ${edge} ${failure ? OUTCOME_TONE[failure.outcome] : ""}`}><input key={shown} data-col={cell} defaultValue={shown} readOnly={disabled} inputMode="decimal" aria-label={label} aria-invalid={Boolean(failure)} title={failure ? reasons({ ...graded, failures: [failure], defects: [] })[0] : undefined}
                onBlur={(event) => { if (event.currentTarget.value !== shown) write(joint.no, column, event.currentTarget.value); }} onKeyDown={(event) => key(event, cell)} onPaste={(event) => paste(event, joint.no, cell)}
                className={`${cellInput} w-[64px] text-right ${failure ? "font-semibold" : "text-navy"}`} /></td>;
            }
            const shown = column.kind === "code" ? joint.codes[column.key] ?? "" : joint.coating ? String(joint.coating) : "";
            const rule = column.kind === "code" && shown ? criteria.find((item) => item.code === shown) : undefined;
            const tone = rule ? `${OUTCOME_TONE[rule.outcome]} font-semibold` : column.kind === "coating" && (joint.coating ?? 0) >= 3 ? "bg-[#fff2d7] text-[#8a5d00] font-semibold" : "";
            const hint = column.kind === "code" ? (rule ? `${shown}, ${CODES[shown].toLowerCase()}: ${rule.criterion} ${rule.outcome}.` : "Blank is OK. Type a code: SD, TD, PT, PS, NFS, ST, GT, OT, GS, RFD, IE, IC, BB, CRK or BENT.") : "1 intact · 2 over 80% · 3 65 to 80% · 4 under 65%";
            return <td key={column.key} className={`border-b border-line p-0 ${edge} ${tone}`}><input key={shown} data-col={cell} defaultValue={shown} readOnly={disabled} list={column.kind === "code" ? "tally-codes" : undefined} placeholder={column.kind === "code" ? "OK" : "–"} aria-label={label} title={hint}
              onBlur={(event) => { if (event.currentTarget.value.trim().toUpperCase() !== shown) write(joint.no, column, event.currentTarget.value); }} onKeyDown={(event) => key(event, cell)} onPaste={(event) => paste(event, joint.no, cell)}
              className={`${cellInput} text-center uppercase [&::-webkit-calendar-picker-indicator]:hidden ${column.kind === "code" ? "w-[62px]" : "w-[44px]"} ${tone ? "" : "text-navy"}`} /></td>;
          })}
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

export function TallyView() {
  const { state, update } = useApp();
  const tallies = state.inspections.filter((inspection) => inspection.joints && inspection.job && inspection.connection);
  const [selectedId, setSelectedId] = useState<string | undefined>(() => (tallies.find((item) => item.status === "Draft" || item.status === "Returned") ?? tallies[0])?.id);
  const [creating, setCreating] = useState(false);
  const [report, setReport] = useState(false);
  // The summary numbers filter the grid. The rows are fixed when the filter is chosen, so fixing a pipe doesn't make it vanish mid-edit.
  const [filter, setFilter] = useState<{ id: string; label: string; rows: number[] }>();
  const selected = tallies.find((item) => item.id === selectedId);
  const record = state.records.find((item) => item.id === selected?.assetId);
  const certificate = record?.certificates.find((item) => item.id === selected?.certificateId);
  const canWork = state.role === "Admin" || state.role === "Engineer";
  const canEdit = canWork && (selected?.status === "Draft" || selected?.status === "Returned");
  const summary = selected ? summarizeTally(selected.connection!, selected.job!, selected.joints!) : undefined;
  const count = (...labels: string[]) => summary?.rows.filter((row) => labels.includes(row.label)).reduce((total, row) => total + row.count, 0) ?? 0;
  const rows = filter && filter.id === selected?.id ? filter : undefined;
  function filterBy(label: string, classes: (FinalClass | "Pending")[]) {
    if (!selected || !classes.length || rows?.label === label) return setFilter(undefined);
    setFilter({ id: selected.id, label, rows: selected.joints!.filter((joint) => classes.includes(gradePipe(selected.connection!, selected.job!, joint).final)).map((joint) => joint.no) });
  }
  const expired = selected && canEdit ? expiredEquipment(state.equipment ?? [], selected.job!.equipmentIds, state.demoDate) : [];

  const changeJoints = (change: (joints: Joint[]) => Joint[]) => { if (selected) update((current) => { const item = current.inspections.find((inspection) => inspection.id === selected.id); return item?.joints ? updateInspection(current, item.id, { joints: change(item.joints) }) : current; }); };
  const changeJob = (patch: Partial<TallyJob>) => { if (selected) update((current) => { const item = current.inspections.find((inspection) => inspection.id === selected.id); return item?.job ? updateInspection(current, item.id, { job: { ...item.job, ...patch } }) : current; }); };
  const saveNotes = (notes: string) => { if (selected) update((current) => updateInspection(current, selected.id, { notes })); };
  function submit() { if (selected) flushSync(() => update((current) => submitInspection(current, selected.id))); }
  function removeDraft() {
    if (!selected || !window.confirm(`Delete the draft tally sheet for ${record?.assetRef ?? "this job"}? This cannot be undone.`)) return;
    if (update((current) => deleteInspection(current, selected.id))) setSelectedId(undefined);
  }

  return <div className="flex flex-col gap-5">
    <Card><CardHeader className="flex-row items-start justify-between gap-3"><div><div className="eyebrow">Jobs</div><CardTitle>{tallies.length} tally sheet{tallies.length === 1 ? "" : "s"}</CardTitle></div>{canWork && !creating && <Button className="press" onClick={() => setCreating(true)}><Plus data-icon="inline-start" />New tally sheet</Button>}</CardHeader>
      <CardContent>
        {tallies.length ? <div className="flex flex-col gap-1">{tallies.map((inspection) => {
          const job = state.records.find((item) => item.id === inspection.assetId);
          const counts = summarizeTally(inspection.connection!, inspection.job!, inspection.joints!);
          return <button key={inspection.id} type="button" onClick={() => setSelectedId(inspection.id)} className={`focus-ring grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-lg px-3 py-2.5 text-left text-sm sm:grid-cols-[140px_1fr_200px_100px] ${inspection.id === selectedId ? "bg-[#e8f3f8]" : "[@media(hover:hover)]:hover:bg-paper"}`}>
            <span className="tally-mono font-semibold text-navy">{job?.assetRef ?? "Unknown job"}</span>
            <span className="hidden truncate text-slate-600 sm:block">{job?.owner} · {job?.site} · {inspection.connection && connectionLabel(inspection.connection)}</span>
            <span className="tally-mono hidden text-xs text-slate-500 sm:block">{counts.total - counts.pending}/{counts.total} graded · {counts.downgraded.length} not accepted</span>
            <Badge className="justify-self-end" variant={STATUS_BADGE[inspection.status]}>{inspection.status}</Badge>
          </button>;
        })}</div> : <p className="text-sm text-slate-500">No tally sheets yet. Open one for a work order to start measuring.</p>}
        {creating && <NewTally onCreated={(id) => { setSelectedId(id); setCreating(false); }} onCancel={() => setCreating(false)} />}
        {!canWork && <p className="mt-3 text-xs text-slate-500">Switch to Engineer or Admin to open or fill in a tally sheet.</p>}
      </CardContent>
    </Card>

    {selected && record && summary ? <Card>
      <CardHeader className="gap-4 border-b border-line">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">F.582 · {record.assetRef}</div><CardTitle className="mt-1">{TALLY_TITLE} tally sheet</CardTitle><p className="mt-1 text-sm text-slate-500">{connectionLabel(selected.connection!)}{selected.connection!.sample && " · sample limits, not DS-1 values"} · Inspector: {selected.inspector}</p></div><Badge variant={STATUS_BADGE[selected.status]}>{selected.status}</Badge></div>
        <FormHeader inspection={selected} customer={record.owner} rig={record.site} reportNo={certificate?.number} date={selected.submittedAt?.slice(0, 10) ?? state.demoDate} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="group" aria-label="Show pipes">{([["All pipes", summary.total, "text-navy", []], ["Premium-Accepted", count("Premium-Accepted", "Class 1 (New)"), "text-success", ["Premium-Accepted", "Class 1 (New)"]], ["Rework", count("Premium-Rework", "Class 1-Rework"), "text-[#8a5d00]", ["Premium-Rework", "Class 1-Rework"]], ["Down-graded", count("Class-2", "Bent", "Scrap"), "text-danger", ["Class-2", "Bent", "Scrap"]], ["To measure", summary.pending, summary.pending ? "text-[#8a5d00]" : "text-navy", ["Pending"]]] as const).map(([label, value, tone, classes]) => {
          const on = classes.length ? rows?.label === label : !rows;
          return <button key={label} type="button" aria-pressed={on} disabled={Boolean(classes.length) && !value && !on} onClick={() => filterBy(label, [...classes])} className={`press focus-ring rounded-lg border px-3 py-2 text-left disabled:cursor-default ${on ? "border-navy bg-[#f3f8fb] shadow-[inset_0_0_0_1px_#0b3151]" : "border-line bg-white [@media(hover:hover)]:hover:border-[#b8cedc]"}`}><span className="eyebrow">{label}</span><span className={`tally-mono mt-0.5 block text-2xl font-semibold ${tone}`}><RollingNumber value={value} /></span></button>;
        })}</div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-5">
        <ReportDetails key={`details-${selected.id}`} inspection={selected} disabled={!canEdit} onChange={changeJob} />
        {expired.length > 0 && <div role="alert" className="animate-rise flex gap-3 rounded-lg border border-[#f0c2c3] bg-[#fff6f6] px-4 py-3 text-sm text-danger"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div><strong>This sheet can&apos;t be submitted.</strong> {expired.map((item) => `${item.kind} ${item.serial} calibration expired ${formatDate(item.calibrationDue)}`).join("; ")}. Record the new calibration in <Link href="/equipment" className="font-semibold underline">Equipment</Link>, or untick the instrument in Report details.</div></div>}
        <TallyGrid key={`grid-${selected.id}`} inspection={selected} rows={rows?.rows} disabled={!canEdit} onChange={changeJoints} />
        <div><label className="eyebrow" htmlFor="tally-notes">Comments</label><Textarea id="tally-notes" className="mt-1.5" defaultValue={selected.notes} key={selected.id} disabled={!canEdit} onBlur={(event) => { if (event.currentTarget.value !== selected.notes) saveNotes(event.currentTarget.value); }} placeholder="Conditions on site, anything the reviewer should know…" /></div>
        {selected.reviewerComment && selected.status === "Returned" && <div className="flex gap-2 rounded-lg border border-[#f0c2c3] bg-[#fff6f6] px-3 py-3 text-sm text-danger"><X className="mt-0.5 size-4 shrink-0" /><span><strong>Returned for correction.</strong> {selected.reviewerComment}</span></div>}
        <div className="border-t border-line pt-4" aria-live="polite">{selected.status === "Submitted" ? <div className="animate-rise flex flex-wrap items-center gap-3 rounded-lg border border-success/25 bg-success/[.06] px-4 py-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-success text-white"><Check className="draw-check size-5" strokeWidth={3} aria-hidden="true" /></span><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-navy">Sent for review</div><div className="text-xs text-slate-600">The F.581 summary is filled in from this tally. A reviewer approves it in Approvals, and it is issued with a number and a QR code.</div></div><Button variant="outline" size="sm" onClick={() => setReport(true)}><FileText data-icon="inline-start" />Preview report</Button><Button asChild size="sm"><Link href="/approvals">Open Approvals<ArrowRight data-icon="inline-end" /></Link></Button></div>
          : selected.status === "Issued" ? <div className="animate-rise flex flex-wrap items-center gap-3 rounded-lg border border-success/25 bg-success/[.06] px-4 py-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-success text-white"><ShieldCheck className="size-5" aria-hidden="true" /></span><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-navy">Report issued{certificate && ` · ${certificate.number}`}</div><div className="text-xs text-slate-600">Print it or show its QR code from Reports.</div></div><Button variant="outline" size="sm" onClick={() => setReport(true)}><FileText data-icon="inline-start" />View report</Button><Button asChild size="sm"><Link href="/certificates">Open Reports<ArrowRight data-icon="inline-end" /></Link></Button></div>
          : <div className="flex flex-wrap items-center justify-end gap-2">{selected.status === "Draft" && canWork && <Button variant="ghost" className="mr-auto text-danger hover:bg-[#fff3f3]" onClick={removeDraft}><Trash2 data-icon="inline-start" />Delete draft</Button>}{summary.pending > 0 && <span className="text-xs text-slate-500">{summary.pending} pipe{summary.pending === 1 ? "" : "s"} still to measure</span>}<Button variant="outline" className="press" onClick={() => setReport(true)}><FileText data-icon="inline-start" />Preview report</Button><Button className="press" onClick={submit} disabled={!canEdit || summary.pending > 0 || expired.length > 0}><Send data-icon="inline-start" />Submit for review</Button></div>}</div>
      </CardContent>
    </Card> : <Card><CardContent className="flex min-h-[320px] flex-col items-center justify-center p-8 text-center"><ClipboardList className="size-10 text-[#b8cedc]" /><h2 className="mt-4 font-semibold text-navy">Open a tally sheet</h2><p className="mt-2 max-w-sm text-sm text-slate-500">Choose a work order above, or open a new tally sheet. Every reading is checked against the connection&apos;s dimension table as you type.</p></CardContent></Card>}
    {report && selected && <TallyReportDialog inspectionId={selected.id} onClose={() => setReport(false)} />}
  </div>;
}
