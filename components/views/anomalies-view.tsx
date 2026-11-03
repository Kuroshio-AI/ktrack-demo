"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { advanceAnomaly, ANOMALY_STATUSES, canAdvance, NEXT_STEP, startReinspection, type Anomaly } from "@/lib/anomaly";
import { formatDate } from "@/lib/utils";

const TONE = { Accept: "success", Monitor: "warning", Repair: "danger" } as const;
const RANK = { Repair: 0, Monitor: 1, Accept: 2 };
const kpText = (kp: number) => kp.toFixed(3);
const short = (line: string) => line.split(" · ")[0];
// What the next step asks for, in the words of the button and the note's label.
const STEP_COPY: Record<string, { button: string; note: string; placeholder: string }> = {
  "Action planned": { button: "Plan action", note: "Why and how", placeholder: "Support the span before the next storm season" },
  Repaired: { button: "Record repair", note: "Work order and what was done", placeholder: "WO-26-0301, two grout bags placed by the dive team" },
  Closed: { button: "Close out", note: "Close-out note", placeholder: "Re-inspection found it within criteria" },
};

export function AnomaliesView() {
  const { state } = useApp();
  const params = useSearchParams();
  const anomalies = state.anomalies ?? [];
  const lines = [...new Set(anomalies.map((item) => item.line))];
  const kinds = [...new Set(anomalies.map((item) => item.kind))].sort();
  const [filter, setFilter] = useState({ line: "", status: "open", severity: "", kind: "" });
  const [selectedId, setSelectedId] = useState<string | undefined>(() => params.get("anomaly") ?? undefined);
  const shown = anomalies
    .filter((item) => (!filter.line || item.line === filter.line) && (!filter.kind || item.kind === filter.kind) && (!filter.severity || item.result === filter.severity)
      && (filter.status === "" || (filter.status === "open" ? item.status !== "Closed" : item.status === filter.status)))
    .sort((a, b) => RANK[a.result] - RANK[b.result] || a.line.localeCompare(b.line) || a.kp - b.kp);
  const selected = anomalies.find((item) => item.id === selectedId) ?? shown[0];
  const open = anomalies.filter((item) => item.status !== "Closed");
  const set = (key: keyof typeof filter) => (event: React.ChangeEvent<HTMLSelectElement>) => setFilter({ ...filter, [key]: event.target.value });

  if (!anomalies.length) return <Card><CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-2 p-8 text-center text-sm text-slate-500"><p>No anomalies yet. Issuing a survey report files every finding here.</p><Button asChild variant="outline" size="sm"><Link href="/surveys">Open surveys</Link></Button></CardContent></Card>;

  return <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
    <Card className="self-start"><CardHeader className="border-b border-line">
      <div className="eyebrow">{open.length} open · {open.filter((item) => item.result === "Repair").length} for repair</div><CardTitle>Anomaly register</CardTitle>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Select aria-label="Line" className="h-8 py-0 text-sm" value={filter.line} onChange={set("line")}><option value="">All lines</option>{lines.map((line) => <option key={line} value={line}>{short(line)}</option>)}</Select>
        <Select aria-label="Status" className="h-8 py-0 text-sm" value={filter.status} onChange={set("status")}><option value="open">Not closed</option><option value="">Any status</option>{ANOMALY_STATUSES.map((status) => <option key={status}>{status}</option>)}</Select>
        <Select aria-label="Severity" className="h-8 py-0 text-sm" value={filter.severity} onChange={set("severity")}><option value="">Any severity</option><option>Repair</option><option>Monitor</option></Select>
        <Select aria-label="Type" className="h-8 py-0 text-sm" value={filter.kind} onChange={set("kind")}><option value="">Any type</option>{kinds.map((kind) => <option key={kind}>{kind}</option>)}</Select>
      </div>
    </CardHeader>
      <CardContent className="p-2">{shown.length ? <ul className="flex flex-col">{shown.map((item) => <li key={item.id}><button type="button" onClick={() => setSelectedId(item.id)} className={`focus-ring flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left ${selected?.id === item.id ? "bg-[#e8f3f8]" : "hover:bg-paper"}`}>
        <span className="min-w-0"><span className="block text-xs font-semibold tabular-nums text-slate-500">{item.number} · {short(item.line)} · KP {kpText(item.kp)}</span><span className="block truncate font-semibold text-navy">{item.kind} <span className="font-normal text-slate-500">· {item.sightings.at(-1)?.measure}</span></span></span>
        <span className="flex shrink-0 flex-col items-end gap-1"><Badge variant={item.status === "Closed" ? "outline" : TONE[item.result]}>{item.result}</Badge><span className="text-xs text-slate-500">{item.status}</span></span>
      </button></li>)}</ul> : <p className="px-3 py-10 text-center text-sm text-slate-500">Nothing matches these filters.</p>}</CardContent>
    </Card>
    {selected ? <AnomalyDetail key={selected.id} anomaly={selected} /> : <Card><CardContent className="p-8 text-center text-sm text-slate-500">Pick an anomaly to see its history.</CardContent></Card>}
  </div>;
}

function AnomalyDetail({ anomaly }: { anomaly: Anomaly }) {
  const { state, update } = useApp();
  const router = useRouter();
  function reinspect() {
    let surveyId: string | undefined;
    if (update((current) => { const result = startReinspection(current, anomaly.id, current.role); surveyId = result.surveyId; return result.state; }) && surveyId) router.push(`/surveys?survey=${surveyId}`);
  }
  const next = NEXT_STEP[anomaly.status];
  const [note, setNote] = useState("");
  const [action, setAction] = useState(anomaly.action);
  const [target, setTarget] = useState(anomaly.target ?? "");
  const [error, setError] = useState("");
  const first = anomaly.sightings[0];
  const last = anomaly.sightings.at(-1)!;
  const survey = state.surveys?.find((item) => item.id === last.surveyId);
  const allowed = canAdvance(anomaly, state.role);

  function advance() {
    if (!note.trim()) { setError("Add a note: it goes on the anomaly's timeline."); return; }
    if (update((current) => advanceAnomaly(current, anomaly.id, note, { action, target }, current.role))) { setNote(""); setError(""); }
  }

  return <Card className="min-w-0"><CardHeader className="border-b border-line">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0"><div className="eyebrow">{anomaly.number} · {anomaly.line}</div><CardTitle className="mt-1">{anomaly.kind} at KP {kpText(anomaly.kp)}</CardTitle><p className="mt-1 text-sm text-slate-500">{last.measure} · {anomaly.result === "Accept" ? "now within criteria" : `${anomaly.result} by the client's criteria`}</p></div>
      <Badge className="shrink-0 self-start" variant={TONE[anomaly.result]}>{anomaly.result}</Badge>
    </div>
    {/* The anomaly's life in five steps; the current one is filled. */}
    <ol className="mt-5 grid grid-cols-5 gap-1" aria-label="Status">{ANOMALY_STATUSES.map((status, index) => {
      const reached = index <= ANOMALY_STATUSES.indexOf(anomaly.status);
      const current = status === anomaly.status;
      return <li key={status} aria-current={current ? "step" : undefined} className="min-w-0">
        <div className={`h-1.5 rounded-full ${reached ? anomaly.status === "Closed" ? "bg-success" : "bg-accent" : "bg-line"}`} />
        <div className={`mt-1.5 truncate text-xs ${current ? "font-semibold text-navy" : reached ? "text-slate-600" : "text-slate-400"}`}>{reached && !current && <Check className="mr-0.5 inline size-3" aria-hidden="true" />}{status}</div>
      </li>;
    })}</ol>
  </CardHeader>
    <CardContent className="flex flex-col gap-6 p-5">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
        <div><dt className="eyebrow">Recommended action</dt><dd className="mt-1 font-semibold text-navy">{anomaly.action}</dd></div>
        <div><dt className="eyebrow">Target date</dt><dd className="mt-1 font-semibold text-navy">{anomaly.target ? formatDate(anomaly.target) : "Not set"}</dd></div>
        <div><dt className="eyebrow">First found</dt><dd className="mt-1 font-semibold text-navy">{first.survey} · {first.date.slice(0, 4)}</dd></div>
        <div><dt className="eyebrow">Last seen</dt><dd className="mt-1 font-semibold text-navy">{survey ? <Link className="underline-offset-4 hover:underline" href={`/surveys?survey=${survey.id}`}>{last.survey}</Link> : last.survey} · {last.date.slice(0, 4)}</dd></div>
      </dl>

      <section><div className="eyebrow">By campaign</div><ol className="mt-2 flex flex-wrap items-stretch gap-2">{anomaly.sightings.map((sighting, index) => <li key={sighting.surveyId} className="flex items-center gap-2">
        {index > 0 && <span className="text-slate-300" aria-hidden="true">→</span>}
        <div className="rounded-lg border border-line px-3 py-2"><div className="text-xs text-slate-500">{sighting.date.slice(0, 4)} · {sighting.survey}</div><div className="mt-0.5 flex items-center gap-2 font-semibold text-navy">{sighting.measure}<Badge variant={TONE[sighting.result]}>{sighting.result}</Badge></div></div>
      </li>)}</ol></section>

      <section><div className="eyebrow">Timeline</div><ol className="mt-3 flex flex-col">{anomaly.history.map((entry, index) => <li key={`${entry.at}-${index}`} className="relative flex gap-3 pb-4 last:pb-0">
        {index < anomaly.history.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-line" aria-hidden="true" />}
        <span className={`relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 ${index === anomaly.history.length - 1 ? "border-accent bg-accent" : "border-[#9fb7c8] bg-white"}`} aria-hidden="true" />
        <div className="min-w-0 text-sm"><div><span className="font-semibold text-navy">{entry.status}</span> <span className="text-xs text-slate-500">· {formatDate(entry.date)} · {entry.by === "system" ? "KTrack" : entry.by}</span></div><p className="text-slate-600">{entry.note}</p></div>
      </li>)}</ol></section>

      {next ? <section className="rounded-lg border border-line bg-paper p-4">
        <div className="text-sm font-semibold text-navy">Next: {next}</div>
        {allowed ? <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {next === "Action planned" && <><div><Label htmlFor="anomaly-action">Action</Label><Input id="anomaly-action" className="mt-1.5 bg-white" value={action} onChange={(event) => setAction(event.target.value)} /></div><div><Label htmlFor="anomaly-target">Target date</Label><Input id="anomaly-target" type="date" className="mt-1.5 bg-white" value={target} onChange={(event) => setTarget(event.target.value)} /></div></>}
          <div className="sm:col-span-2"><Label htmlFor="anomaly-note">{STEP_COPY[next].note}</Label><Textarea id="anomaly-note" className="mt-1.5 bg-white" value={note} onChange={(event) => setNote(event.target.value)} placeholder={STEP_COPY[next].placeholder} /></div>
          {error && <p className="text-sm text-danger sm:col-span-2" role="alert">{error}</p>}
          <div className="flex justify-end sm:col-span-2"><Button onClick={advance}>{STEP_COPY[next].button}</Button></div>
        </div> : <p className="mt-1 text-sm text-slate-500">{anomaly.status === "Re-inspected" ? "A reviewer signs the close-out. Switch to Reviewer or Admin." : "Manager is read-only here. Switch to Engineer, Reviewer or Admin."}</p>}
      </section>
        : anomaly.status === "Repaired" ? <div className="flex flex-col gap-3 rounded-lg bg-paper px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-slate-600"><span className="font-semibold text-navy">Next: re-inspect it.</span> Survey KP {anomaly.kp.toFixed(3)} again and issue the report. If it passes, this moves to Re-inspected; if it still fails, back to Action planned.</p>{state.role !== "Manager" && <Button className="shrink-0" onClick={reinspect}>Start re-inspection survey</Button>}</div>
        : <p className="rounded-lg bg-[#e7f4ed] px-4 py-3 text-sm text-[#187348]">Closed out. A new finding here would open a new anomaly.</p>}
    </CardContent></Card>;
}
