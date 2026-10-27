"use client";

import { Fragment, useState, type FormEvent } from "react";
import { Gauge, Plus } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { addEquipment, recordCalibration } from "@/lib/ams";
import { addMonthsClamped, dateDiffDays, isDateString } from "@/lib/domain";
import { calibrationStatus, type Calibration } from "@/lib/tally";
import { formatDate } from "@/lib/utils";

const STATUS: Record<Calibration, "success" | "warning" | "danger"> = { Valid: "success", "Due soon": "warning", Expired: "danger" };
// ponytail: a one-year default for the next due date; store an interval per instrument if theirs differ.
const nextDue = (calibratedOn: string) => addMonthsClamped(calibratedOn, 12);
const days = (count: number) => `${count} day${count === 1 ? "" : "s"}`;
// Closing the calibration row hands focus back to the instrument's button once it renders again.
const refocus = (id: string) => requestAnimationFrame(() => document.getElementById(`calibrate-${id}`)?.focus());

// The F.581 equipment details, soonest due first. A tally sheet lists the instruments it used and can't be submitted while
// any of them is past its calibration date; recording a calibration here clears that and the matching alert.
export function EquipmentView() {
  const { state, update } = useApp();
  const equipment = [...(state.equipment ?? [])].sort((a, b) => a.calibrationDue.localeCompare(b.calibrationDue));
  const [saved, setSaved] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [calibrating, setCalibrating] = useState<{ id: string; on: string; due: string }>();
  const [error, setError] = useState("");
  const canEdit = state.role === "Admin" || state.role === "Manager";
  const counts = equipment.reduce((total, item) => ({ ...total, [calibrationStatus(item, state.demoDate)]: (total[calibrationStatus(item, state.demoDate)] ?? 0) + 1 }), {} as Partial<Record<Calibration, number>>);

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "");
    try {
      const result = addEquipment(state, { kind: text("kind"), model: text("model"), serial: text("serial"), calibrationDue: text("calibrationDue") });
      if (update(() => result.state)) { setSaved(result.item.id); setAdding(false); setError(""); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The instrument could not be added."); }
  }
  function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!calibrating) return;
    try {
      if (update((current) => recordCalibration(current, calibrating.id, calibrating.on, calibrating.due))) { setSaved(calibrating.id); setCalibrating(undefined); setError(""); refocus(calibrating.id); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The calibration could not be recorded."); }
  }
  const cancel = () => { if (calibrating) refocus(calibrating.id); setAdding(false); setCalibrating(undefined); setError(""); };
  const startCalibration = (id: string) => { setAdding(false); setError(""); setCalibrating({ id, on: state.demoDate, due: nextDue(state.demoDate) }); };

  return <Card><CardHeader className="flex-row flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">Equipment details</div><CardTitle>{equipment.length} instruments</CardTitle></div>
    <div className="flex flex-wrap items-center gap-2">{(["Expired", "Due soon", "Valid"] as const).filter((status) => counts[status]).map((status) => <Badge key={status} variant={STATUS[status]}>{counts[status]} {status.toLowerCase()}</Badge>)}{canEdit && !adding && <Button size="sm" variant="outline" className="press ml-1" onClick={() => { setCalibrating(undefined); setError(""); setAdding(true); }}><Plus data-icon="inline-start" />Add instrument</Button>}</div></CardHeader>
    <CardContent>
      <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full border-collapse text-sm">
        <thead className="form-band"><tr className="text-left text-[10px] font-bold uppercase tracking-[.1em]"><th className="px-3 py-2">Instrument</th><th className="px-3 py-2">Model</th><th className="px-3 py-2">Serial</th><th className="px-3 py-2">Last calibrated</th><th className="px-3 py-2">Next due</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{equipment.map((item) => {
          const status = calibrationStatus(item, state.demoDate);
          const left = dateDiffDays(item.calibrationDue, state.demoDate);
          const open = calibrating?.id === item.id;
          return <Fragment key={item.id}>
            <tr key={`${item.id}-${item.calibrationDue}`} className={`border-t border-line ${saved === item.id ? "row-glow" : ""} ${open ? "bg-[#fffaf5]" : ""}`}>
              <td className="px-3 py-2.5"><span className="flex items-center gap-2 font-semibold text-navy"><Gauge className="size-4 text-slate-400" aria-hidden="true" />{item.kind}</span></td>
              <td className="tally-mono px-3 py-2.5 text-slate-600">{item.model}</td>
              <td className="tally-mono px-3 py-2.5 text-slate-600">{item.serial}</td>
              <td className="tally-mono whitespace-nowrap px-3 py-2.5 text-slate-600">{item.calibratedOn ? formatDate(item.calibratedOn) : "–"}</td>
              <td className="whitespace-nowrap px-3 py-2.5"><span className="tally-mono text-navy">{formatDate(item.calibrationDue)}</span>{status !== "Valid" && <Badge variant={STATUS[status]} className="ml-2">{status === "Expired" ? `Expired ${days(-left)} ago` : left === 0 ? "Due today" : `Due in ${days(left)}`}</Badge>}</td>
              <td className="px-3 py-2 text-right">{canEdit && !open && <Button id={`calibrate-${item.id}`} size="sm" variant={status === "Valid" ? "ghost" : "default"} className="press whitespace-nowrap" onClick={() => startCalibration(item.id)}>Record calibration</Button>}</td>
            </tr>
            {open && <tr className="bg-[#fffaf5]" onKeyDown={(event) => { if (event.key === "Escape") cancel(); }}><td colSpan={6} className="px-3 pb-3 pt-0">
              <form onSubmit={record} className="flex flex-wrap items-end gap-3 rounded-lg border border-[#e9c9ae] bg-white p-3">
                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">Calibrated on<Input type="date" required autoFocus max={state.demoDate} className="h-9 w-[160px]" value={calibrating.on} onChange={(event) => { const on = event.target.value; setCalibrating({ ...calibrating, on, due: isDateString(on) ? nextDue(on) : calibrating.due }); }} /></label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">Next due, from the certificate<Input type="date" required min={calibrating.on} className="h-9 w-[160px]" value={calibrating.due} onChange={(event) => setCalibrating({ ...calibrating, due: event.target.value })} /></label>
                <div className="flex gap-1"><Button type="submit" size="sm" className="press">Save calibration</Button><Button type="button" size="sm" variant="ghost" onClick={cancel}>Cancel</Button></div>
              </form>
            </td></tr>}
          </Fragment>;
        })}
        {!equipment.length && !adding && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No instruments yet. Add the ones your inspectors use, with their calibration dates.</td></tr>}
        {/* The new instrument's fields belong to the form below the table, so Enter adds it and the browser checks required fields. */}
        {adding && <tr className="border-t border-line bg-[#fffaf5]" onKeyDown={(event) => { if (event.key === "Escape") cancel(); }}>
          <td className="px-3 py-2"><Input form="add-instrument" name="kind" aria-label="Instrument" placeholder="Thread gauge" list="instrument-kinds" required autoFocus className="h-9 min-w-[150px]" /></td>
          <td className="px-3 py-2"><Input form="add-instrument" name="model" aria-label="Model" placeholder="TG-2" required className="tally-mono h-9 w-[110px]" /></td>
          <td className="px-3 py-2"><Input form="add-instrument" name="serial" aria-label="Serial" placeholder="AMS-TG-0042" required className="tally-mono h-9 w-[150px]" /></td>
          <td className="px-3 py-2 text-slate-400">–</td>
          <td className="px-3 py-2"><Input form="add-instrument" name="calibrationDue" type="date" aria-label="Next due" required className="h-9 w-[160px]" /></td>
          <td className="px-3 py-2"><div className="flex justify-end gap-1"><Button form="add-instrument" type="submit" size="sm" className="press">Add</Button><Button type="button" size="sm" variant="ghost" onClick={cancel}>Cancel</Button></div></td>
        </tr>}</tbody>
      </table></div>
      <form id="add-instrument" onSubmit={add} />
      <datalist id="instrument-kinds">{[...new Set(equipment.map((item) => item.kind))].map((kind) => <option key={kind} value={kind} />)}</datalist>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <p className="mt-3 text-xs text-slate-500">{canEdit ? "A tally sheet can't be submitted while an instrument it used is expired. New sheets list every instrument; untick the unused ones in the sheet's Report details." : "Switch to Admin or Manager to add an instrument or record a calibration."}</p>
    </CardContent>
  </Card>;
}
