"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { FileCheck2, Plus, Printer, Trash2 } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { BRAND } from "@/lib/client";
import { SPREAD_SITES } from "@/lib/safeen";
import { CRITERIA, issueBlockers, issueSurvey, newPoint, POINT_CODES, saveSurvey, summarizeSurvey, unfitEquipment, type Graded, type Survey, type SurveyPoint } from "@/lib/survey";
import type { AssetRecord } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const TONE = { Accept: "success", Monitor: "warning", Repair: "danger", Pending: "outline" } as const;
const isRov = (record: AssetRecord) => record.status === "Active" && /\brov\b/i.test(record.assetType) && !/tool|gauge|probe|tms/i.test(record.assetType);
// The instruments whose readings go on the sheet: CP probes and UT gauges.
const isInstrument = (record: AssetRecord) => record.status === "Active" && /cp probe|thickness|\but\b/i.test(record.assetType);
const kpText = (kp: number) => kp.toFixed(3);
const criteriaText = `CP ${CRITERIA.protectedMv} to ${CRITERIA.overMv} mV Ag/AgCl · wall watched below ${CRITERIA.millTolerance * 100}% of nominal, repaired below the minimum allowable · anodes watched past ${CRITERIA.anodeWatch}% consumed, retrofitted past ${CRITERIA.anodeRetrofit}%`;

type FormState = { title: string; line: string; site: string; date: string; rovId: string; equipmentIds: string[]; nominalWall: string; minWall: string };

export function SurveysView() {
  const { state, update } = useApp();
  const surveys = state.surveys ?? [];
  const [selectedId, setSelectedId] = useState<string>();
  const [form, setForm] = useState<FormState>();
  const [formError, setFormError] = useState("");
  const [printing, setPrinting] = useState<Survey>();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (printing) dialog.current?.showModal(); }, [printing]);
  const canEdit = state.role !== "Manager";
  const canIssue = state.role === "Admin" || state.role === "Reviewer";
  const selected = surveys.find((survey) => survey.id === selectedId) ?? surveys[0];
  const rovs = state.records.filter(isRov);
  const instruments = state.records.filter(isInstrument);

  function startNew() {
    setFormError("");
    setForm({ title: "", line: "", site: SPREAD_SITES[0].name, date: state.demoDate, rovId: rovs[0]?.id ?? "", equipmentIds: instruments.filter((record) => record.site === SPREAD_SITES[0].name).map((record) => record.id), nominalWall: "", minWall: "" });
  }
  function create() {
    if (!form) return;
    const nominalWall = Number(form.nominalWall);
    const minWall = Number(form.minWall);
    if (!form.title.trim() || !form.line.trim()) { setFormError("Name the survey and the line or riser it covers."); return; }
    if (!(nominalWall > 0) || !(minWall > 0) || minWall >= nominalWall) { setFormError("Enter the nominal wall and a smaller minimum allowable wall, in mm."); return; }
    let createdId: string | undefined;
    if (update((current) => { const next = saveSurvey(current, { ...form, title: form.title.trim(), line: form.line.trim(), rovId: form.rovId || undefined, nominalWall, minWall, points: [newPoint(0)] }); createdId = next.surveys?.[0].id; return next; })) { setSelectedId(createdId); setForm(undefined); }
  }

  return <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
    <Card className="self-start"><CardHeader className="flex-row items-center justify-between gap-3 border-b border-line"><div><div className="eyebrow">{surveys.length} survey{surveys.length === 1 ? "" : "s"}</div><CardTitle>Survey tallies</CardTitle></div>{canEdit && <Button size="sm" onClick={startNew}><Plus data-icon="inline-start" />New survey</Button>}</CardHeader>
      <CardContent className="p-3 sm:p-4">{surveys.length ? <div className="flex flex-col gap-1">{surveys.map((survey) => { const summary = summarizeSurvey(survey); return <button key={survey.id} type="button" onClick={() => { setSelectedId(survey.id); setForm(undefined); }} className={`focus-ring flex items-start justify-between gap-3 rounded-lg px-3 py-3 text-left ${!form && selected?.id === survey.id ? "bg-[#e8f3f8]" : "hover:bg-paper"}`}>
        <span className="min-w-0"><span className="block whitespace-nowrap text-xs font-semibold tabular-nums text-slate-500">{survey.number} · {formatDate(survey.date)}</span><span className="mt-0.5 line-clamp-2 block font-semibold leading-snug text-navy">{survey.title}</span><span className="mt-0.5 block text-xs text-slate-500">{survey.points.length} points{summary.repair ? ` · ${summary.repair} for repair` : ""}{summary.monitor ? ` · ${summary.monitor} to monitor` : ""}</span></span>
        <Badge className="shrink-0" variant={survey.status === "Issued" ? "success" : "outline"}>{survey.status}</Badge>
      </button>; })}</div> : <p className="px-3 py-10 text-center text-sm text-slate-500">No surveys yet. Start one when the ROV goes down on a line or riser.</p>}</CardContent>
    </Card>

    {form ? <Card><CardHeader className="border-b border-line"><div className="eyebrow">New survey</div><CardTitle>What is the ROV surveying?</CardTitle></CardHeader>
      <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label htmlFor="survey-title">Survey *</Label><Input id="survey-title" className="mt-1.5" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Riser R-4 CP and UT survey" /></div>
        <div><Label htmlFor="survey-line">Line or riser *</Label><Input id="survey-line" className="mt-1.5" value={form.line} onChange={(event) => setForm({ ...form, line: event.target.value })} placeholder="Upper Zakum riser R-4" /></div>
        <div><Label htmlFor="survey-date">Date *</Label><Input id="survey-date" type="date" className="mt-1.5" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></div>
        <div><Label htmlFor="survey-site">Spread</Label><Select id="survey-site" className="mt-1.5" value={form.site} onChange={(event) => setForm({ ...form, site: event.target.value })}>{SPREAD_SITES.filter((site) => site.kind !== "Base").map((site) => <option key={site.name}>{site.name}</option>)}</Select></div>
        <div><Label htmlFor="survey-rov">ROV</Label><Select id="survey-rov" className="mt-1.5" value={form.rovId} onChange={(event) => setForm({ ...form, rovId: event.target.value })}><option value="">None</option>{rovs.map((record) => <option key={record.id} value={record.id}>{record.assetRef} · {record.assetType}</option>)}</Select></div>
        <div><Label htmlFor="survey-nominal">Nominal wall (mm) *</Label><Input id="survey-nominal" type="number" step="0.1" min="0" inputMode="decimal" className="mt-1.5" value={form.nominalWall} onChange={(event) => setForm({ ...form, nominalWall: event.target.value })} /></div>
        <div><Label htmlFor="survey-min">Minimum allowable wall (mm) *</Label><Input id="survey-min" type="number" step="0.1" min="0" inputMode="decimal" className="mt-1.5" value={form.minWall} onChange={(event) => setForm({ ...form, minWall: event.target.value })} /></div>
        <fieldset className="sm:col-span-2"><legend className="text-sm font-semibold text-navy">Instruments used</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{instruments.map((record) => <label key={record.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"><input type="checkbox" checked={form.equipmentIds.includes(record.id)} onChange={(event) => setForm({ ...form, equipmentIds: event.target.checked ? [...form.equipmentIds, record.id] : form.equipmentIds.filter((id) => id !== record.id) })} /><span className="min-w-0 truncate"><span className="font-semibold text-navy">{record.assetRef}</span> <span className="text-slate-500">{record.assetType}</span></span></label>)}</div></fieldset>
        {formError && <p className="text-sm text-danger sm:col-span-2" role="alert">{formError}</p>}
      </CardContent>
      <div className="flex justify-end gap-2 border-t border-line p-5"><Button variant="ghost" onClick={() => setForm(undefined)}>Cancel</Button><Button onClick={create}>Start survey</Button></div>
    </Card> : selected ? <SurveySheet survey={selected} canEdit={canEdit} canIssue={canIssue} onPrint={() => setPrinting(selected)} /> : <Card><CardContent className="flex min-h-[420px] items-center justify-center p-8 text-center text-sm text-slate-500">Start a survey to tally CP, wall thickness and anode readings point by point.</CardContent></Card>}

    {printing && createPortal(<dialog ref={dialog} aria-label="Survey report print preview" onClose={() => setPrinting(undefined)} className="certificate-print-area animate-rise fixed inset-0 m-auto max-h-[95vh] w-[min(95vw,900px)] overflow-auto bg-white p-5 backdrop:bg-black/50 sm:p-10">
      <div className="print-hidden mb-5 flex justify-end gap-2"><Button onClick={() => window.print()}>Print / Save PDF</Button><Button variant="outline" onClick={() => dialog.current?.close()}>Close</Button></div>
      <SurveyReport survey={printing} records={state.records} />
    </dialog>, document.body)}
  </div>;
}

function SurveySheet({ survey, canEdit, canIssue, onPrint }: { survey: Survey; canEdit: boolean; canIssue: boolean; onPrint: () => void }) {
  const { state, update } = useApp();
  const [message, setMessage] = useState("");
  const editable = canEdit && survey.status === "Draft";
  const summary = summarizeSurvey(survey);
  const blockers = survey.status === "Draft" ? issueBlockers(survey, state) : [];
  const unfit = new Set(unfitEquipment(survey, state.records, state.demoDate).map(({ record }) => record.id));
  const rov = state.records.find((record) => record.id === survey.rovId);
  const instruments = state.records.filter((record) => survey.equipmentIds.includes(record.id));

  const savePoints = (points: SurveyPoint[]) => update((current) => saveSurvey(current, { ...survey, points }));
  const setPoint = (id: string, patch: Partial<SurveyPoint>) => savePoints(survey.points.map((point) => point.id === id ? { ...point, ...patch } : point).sort((a, b) => a.kp - b.kp));
  // Readings are committed when the field loses focus, so a half-typed "-8" isn't graded mid-entry.
  const reading = (point: SurveyPoint, key: "cp" | "wall" | "anode", text: string) => {
    const value = text.trim() === "" ? undefined : Number(text);
    if (value === undefined || Number.isFinite(value)) setPoint(point.id, { [key]: value });
  };
  function addPoint() { const last = survey.points.at(-1); savePoints([...survey.points, newPoint(last ? Math.round((last.kp + 0.15) * 1000) / 1000 : 0)]); }
  function issue() { if (update((current) => issueSurvey(current, survey.id, current.role))) setMessage(`${survey.number} issued. Print it for the client pack.`); }
  const jump = (id: string) => { const row = document.getElementById(`kp-${id}`); row?.scrollIntoView({ behavior: "smooth", block: "center" }); row?.querySelector<HTMLElement>("input, select")?.focus({ preventScroll: true }); };

  // Cells read as plain figures until touched: no box, no spinner, a border only on hover and focus.
  const flat = "h-8 rounded-md border border-transparent bg-transparent px-2 tabular-nums text-navy transition-colors hover:border-line focus:border-accent focus:bg-white focus:outline-none";
  const cell = (point: SurveyPoint, key: "cp" | "wall" | "anode", label: string) => editable
    ? <input key={`${point.id}-${key}-${point[key] ?? ""}`} aria-label={`${label} at KP ${kpText(point.kp)}`} inputMode="decimal" placeholder="–" className={`${flat} w-[72px] text-right placeholder:text-slate-300`} defaultValue={point[key] ?? ""} onBlur={(event) => reading(point, key, event.target.value)} />
    : <span className="px-2 tabular-nums text-navy">{point[key] ?? "–"}</span>;

  return <Card className="min-w-0"><CardHeader className="border-b border-line"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0"><div className="eyebrow">{survey.number} · {survey.site} · {formatDate(survey.date)}</div><CardTitle className="mt-1">{survey.title}</CardTitle><p className="mt-1 text-sm text-slate-500">{survey.line}</p></div>
    <div className="flex shrink-0 gap-2"><Button variant="outline" size="sm" onClick={onPrint}><Printer data-icon="inline-start" />{survey.status === "Issued" ? "Print report" : "Preview report"}</Button>{survey.status === "Draft" && canIssue && <Button size="sm" onClick={issue} disabled={blockers.length > 0} title={blockers.length ? blockers.join(" ") : undefined}><FileCheck2 data-icon="inline-start" />Issue report</Button>}</div>
  </div>
    <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm">
      <div><dt className="eyebrow">ROV</dt><dd className="mt-1 font-semibold text-navy">{rov ? <Link className="underline-offset-4 hover:underline" href={`/register?asset=${rov.id}`}>{rov.assetRef}</Link> : "None"}</dd></div>
      <div><dt className="eyebrow">Instruments</dt><dd className="mt-1 flex flex-wrap gap-x-3 font-semibold">{instruments.length ? instruments.map((record) => <Link key={record.id} href={`/register?asset=${record.id}`} className={`underline-offset-4 hover:underline ${unfit.has(record.id) ? "text-danger" : "text-navy"}`}>{record.assetRef}{unfit.has(record.id) ? " · out of date" : ""}</Link>) : <span className="font-normal text-slate-500">None listed</span>}</dd></div>
      <div><dt className="eyebrow">Nominal wall</dt><dd className="mt-1 font-semibold tabular-nums text-navy">{survey.nominalWall} mm</dd></div>
      <div><dt className="eyebrow">Minimum allowable</dt><dd className="mt-1 font-semibold tabular-nums text-navy">{survey.minWall} mm</dd></div>
    </dl>
  </CardHeader>
    <CardContent className="flex flex-col gap-5 p-5">
      <Profile survey={survey} graded={summary.graded} onPick={jump} counts={summary} />
      {survey.status === "Issued" ? <p className="rounded-lg bg-[#e7f4ed] px-4 py-3 text-sm text-[#187348]">Issued by the {survey.issuedBy?.toLowerCase()} on {survey.issuedAt ? formatDate(survey.issuedAt.slice(0, 10)) : "file"}. The readings are locked.</p>
        : blockers.length > 0 && <div role="status" className="rounded-lg bg-[#fff2d7] px-4 py-3 text-sm text-[#8a5d00]"><span className="font-semibold">Can&apos;t issue yet: </span>{blockers.join(" ")}</div>}
      {message && <p className="text-sm text-navy" role="status">{message}</p>}
      <div className="relative -mx-5 overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm">
        <thead><tr className="border-b border-line text-xs text-slate-500"><th className="py-2 pl-7 pr-2 font-semibold">KP</th><th className="py-2 pr-4 text-right font-semibold">CP (mV)</th><th className="py-2 pr-4 text-right font-semibold">Wall (mm)</th><th className="py-2 pr-4 text-right font-semibold">Anode (%)</th><th className="py-2 pl-4 pr-2 font-semibold">Anomaly</th><th className="py-2 pr-5 font-semibold">Result</th></tr></thead>
        <tbody>{summary.graded.map(({ point, graded }) => <tr key={point.id} id={`kp-${point.id}`} className={`group scroll-mt-28 border-b border-line/70 align-top ${graded.result === "Repair" ? "bg-[#fdf3f3]" : graded.result === "Monitor" ? "bg-[#fffaf0]" : ""}`}>
          <td className={`py-1.5 pl-5 pr-2 font-mono text-xs font-semibold text-navy ${graded.result === "Repair" ? "shadow-[inset_3px_0_0_#c2373d]" : graded.result === "Monitor" ? "shadow-[inset_3px_0_0_#d99512]" : ""}`}>{editable ? <input key={`${point.id}-kp-${point.kp}`} aria-label="KP" inputMode="decimal" className={`${flat} w-[72px] font-mono`} defaultValue={kpText(point.kp)} onBlur={(event) => { const kp = Number(event.target.value); if (event.target.value.trim() && Number.isFinite(kp) && kp !== point.kp) setPoint(point.id, { kp }); }} /> : <span className="inline-block px-2 py-1.5">{kpText(point.kp)}</span>}</td>
          <td className="py-1.5 pr-2 text-right">{cell(point, "cp", "CP")}</td>
          <td className="py-1.5 pr-2 text-right">{cell(point, "wall", "Wall")}</td>
          <td className="py-1.5 pr-2 text-right">{cell(point, "anode", "Anode")}</td>
          <td className="py-1.5 pl-2 pr-2">{editable ? <select aria-label={`Anomaly at KP ${kpText(point.kp)}`} className={`${flat} w-[150px] cursor-pointer ${point.code === "OK" ? "text-slate-400" : ""}`} value={point.code} onChange={(event) => setPoint(point.id, { code: event.target.value })}>{Object.entries(POINT_CODES).map(([code, { label }]) => <option key={code} value={code}>{code === "OK" ? "None" : label}</option>)}</select> : <span className={`inline-block px-2 py-1.5 ${point.code === "OK" ? "text-slate-400" : "text-navy"}`}>{point.code === "OK" ? "None" : POINT_CODES[point.code]?.label ?? point.code}</span>}{point.note && <div className="mt-0.5 max-w-[220px] px-2 pb-1 text-xs text-slate-500">{point.note}</div>}</td>
          <td className="py-1.5 pr-5"><div className="flex items-start justify-between gap-2"><ResultCell graded={graded} />{editable && <button type="button" className="focus-ring mt-1 rounded p-1 text-slate-400 opacity-0 transition-opacity hover:text-danger focus:opacity-100 group-hover:opacity-100" aria-label={`Remove KP ${kpText(point.kp)}`} onClick={() => savePoints(survey.points.filter((item) => item.id !== point.id))}><Trash2 className="size-4" /></button>}</div></td>
        </tr>)}</tbody>
      </table></div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-[60ch] text-xs leading-relaxed text-slate-500">Sample criteria for the demo: {criteriaText}. The client&apos;s procedure replaces them.</p>
        {editable && <Button variant="outline" size="sm" className="shrink-0" onClick={addPoint}><Plus data-icon="inline-start" />Add point</Button>}
      </div>
    </CardContent></Card>;
}

// The line drawn to scale along its KPs, each point a dot in its result's colour, so trouble shows where it is before any row is read.
const DOT = { Accept: "bg-[#2f9e6a]", Monitor: "bg-[#d99512]", Repair: "bg-[#c2373d]", Pending: "border-2 border-slate-300 bg-white" } as const;
function Profile({ survey, graded, counts, onPick }: { survey: Survey; graded: { point: SurveyPoint; graded: Graded }[]; counts: { accept: number; monitor: number; repair: number; pending: number }; onPick: (id: string) => void }) {
  if (!graded.length) return null;
  const from = graded[0].point.kp;
  const span = graded.at(-1)!.point.kp - from || 1;
  return <div className="rounded-lg border border-line bg-paper px-5 pb-3 pt-4">
    <div className="relative mx-2 h-6">
      <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[#c9d8e3]" />
      {graded.map(({ point, graded: g }) => <button key={point.id} type="button" onClick={() => onPick(point.id)} title={`KP ${kpText(point.kp)} · ${g.result}${g.tags.length ? `: ${g.tags.join(", ")}` : ""}`} aria-label={`KP ${kpText(point.kp)}, ${g.result}`} style={{ left: `${((point.kp - from) / span) * 100}%` }} className={`focus-ring absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-125 ${g.result === "Accept" ? "size-2.5" : "size-3.5 ring-2 ring-white"} ${DOT[g.result]}`} />)}
    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-xs">
      <span className="font-mono text-slate-500">KP {kpText(from)} → {kpText(from + span)} · {survey.points.length} points</span>
      <span className="flex flex-wrap gap-x-4 font-semibold tabular-nums"><span className="text-[#187348]">{counts.accept} accept</span><span className="text-[#8a5d00]">{counts.monitor} monitor</span><span className="text-danger">{counts.repair} repair</span>{counts.pending > 0 && <span className="text-slate-500">{counts.pending} pending</span>}</span>
    </div>
  </div>;
}

// Only what needs action is loud; an accepted point is a quiet word.
function ResultCell({ graded }: { graded: Graded }) {
  if (graded.result === "Accept") return <span className="inline-block py-1.5 text-sm text-slate-400">Accept</span>;
  if (graded.result === "Pending") return <span className="inline-block py-1.5 text-sm italic text-slate-400">Awaiting CP</span>;
  return <div className="py-1"><Badge variant={TONE[graded.result]}>{graded.result}</Badge>{graded.tags.length > 0 && <p className="mt-1 text-xs leading-snug text-slate-600">{graded.tags.join(" · ")}</p>}</div>;
}

// The client-pack report: the tally as surveyed, then the points that need action, then who issued it.
function SurveyReport({ survey, records }: { survey: Survey; records: AssetRecord[] }) {
  const summary = summarizeSurvey(survey);
  const ref = (id?: string) => records.find((record) => record.id === id);
  return <div className="mx-auto border-[8px] border-[#0b3151] p-1"><div className="border border-[#b8cedc] p-5 sm:p-8">
    <div className="flex items-start justify-between gap-4"><div><div className="text-xs font-bold uppercase tracking-[.2em] text-accent">{BRAND.name} · KTrack</div><h2 className="mt-4 text-2xl font-black tracking-tight text-navy">Pipeline survey report</h2><p className="mt-1 text-sm text-slate-500">{survey.title}</p></div><Badge variant={survey.status === "Issued" ? "warning" : "danger"}>{survey.status === "Issued" ? "DEMO" : "DRAFT · NOT ISSUED"}</Badge></div>
    <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
      {[["Report", survey.number], ["Date", formatDate(survey.date)], ["Line or riser", survey.line], ["Spread", survey.site], ["ROV", ref(survey.rovId)?.assetRef ?? "None"], ["Instruments", survey.equipmentIds.map((id) => ref(id)?.assetRef).filter(Boolean).join(", ") || "None"], ["Nominal wall", `${survey.nominalWall} mm`], ["Minimum allowable", `${survey.minWall} mm`]].map(([label, value]) => <div key={label}><dt className="eyebrow">{label}</dt><dd className="mt-1 font-semibold text-navy">{value}</dd></div>)}
    </dl>
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Points", survey.points.length], ["Accept", summary.accept], ["Monitor", summary.monitor], ["Repair", summary.repair]].map(([label, value]) => <div key={label} className="rounded-lg border border-line px-3 py-2"><div className="eyebrow">{label}</div><div className="mt-0.5 text-xl font-bold tabular-nums text-navy">{value}</div></div>)}</div>
    <p className="mt-3 text-xs text-slate-500">CP range {summary.cpRange ? `${summary.cpRange[1]} to ${summary.cpRange[0]} mV` : "not read"} · thinnest wall {summary.minWallRead !== undefined ? `${summary.minWallRead} mm` : "not read"}</p>
    <table className="mt-6 w-full text-left text-xs"><thead><tr className="border-b border-line text-slate-500"><th className="py-1.5 pr-2 font-semibold">KP</th><th className="py-1.5 pr-2 text-right font-semibold">CP (mV)</th><th className="py-1.5 pr-2 text-right font-semibold">Wall (mm)</th><th className="py-1.5 pr-2 text-right font-semibold">Anode (%)</th><th className="py-1.5 pr-2 font-semibold">Anomaly</th><th className="py-1.5 text-right font-semibold">Result</th></tr></thead>
      <tbody>{summary.graded.map(({ point, graded }) => <tr key={point.id} className="border-b border-line/70"><td className="py-1 pr-2 font-mono text-navy">{kpText(point.kp)}</td><td className="py-1 pr-2 text-right tabular-nums">{point.cp ?? "–"}</td><td className="py-1 pr-2 text-right tabular-nums">{point.wall ?? "–"}</td><td className="py-1 pr-2 text-right tabular-nums">{point.anode ?? "–"}</td><td className="py-1 pr-2">{point.code}</td><td className={`py-1 text-right font-semibold ${graded.result === "Repair" ? "text-danger" : graded.result === "Monitor" ? "text-[#8a5d00]" : "text-navy"}`}>{graded.result}</td></tr>)}</tbody></table>
    {summary.anomalies.length > 0 && <div className="mt-6"><div className="eyebrow">Points needing action</div><ul className="mt-2 flex flex-col gap-2 text-sm">{summary.anomalies.map(({ point, graded }) => <li key={point.id} className="text-navy"><span className="font-mono font-semibold">KP {kpText(point.kp)}</span> · <span className="font-semibold">{graded.result}</span>: {graded.reasons.join("; ")}{point.note ? `. ${point.note}` : ""}</li>)}</ul></div>}
    <p className="mt-6 text-xs text-slate-500">Sample criteria: {criteriaText}.</p>
    <div className="mt-8 grid gap-8 border-t border-line pt-6 sm:grid-cols-2"><div><div className="eyebrow">Surveyed by</div><div className="mt-6 border-b border-slate-400" /><div className="mt-1 text-xs text-slate-500">Party chief · {formatDate(survey.date)}</div></div><div><div className="eyebrow">Issued by</div><div className="mt-6 border-b border-slate-400" /><div className="mt-1 text-xs text-slate-500">{survey.status === "Issued" && survey.issuedAt ? `Authorised ${survey.issuedBy?.toLowerCase()} · ${formatDate(survey.issuedAt.slice(0, 10))}` : "Not issued"}</div></div></div>
  </div></div>;
}
