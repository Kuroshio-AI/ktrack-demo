"use client";

import { useState } from "react";
import { Gauge } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { isDateString } from "@/lib/domain";
import { calibrationStatus, type Calibration } from "@/lib/tally";
import { formatDate } from "@/lib/utils";

const STATUS: Record<Calibration, "success" | "warning" | "danger"> = { Valid: "success", "Due soon": "warning", Expired: "danger" };

// The instruments on the F.581 equipment details. A tally sheet lists the ones it used and can't be submitted while any of
// them is past its calibration date; recording a new due date here clears that and the matching alert.
export function EquipmentView() {
  const { state, update } = useApp();
  const equipment = state.equipment ?? [];
  const [saved, setSaved] = useState<string>();
  const canEdit = state.role === "Admin" || state.role === "Manager";
  const counts = equipment.reduce((total, item) => ({ ...total, [calibrationStatus(item, state.demoDate)]: (total[calibrationStatus(item, state.demoDate)] ?? 0) + 1 }), {} as Partial<Record<Calibration, number>>);

  function recordCalibration(id: string, date: string) {
    if (!isDateString(date)) return;
    if (update((current) => ({ ...current, equipment: (current.equipment ?? []).map((item) => item.id === id ? { ...item, calibrationDue: date } : item) }))) setSaved(id);
  }

  return <Card><CardHeader className="flex-row flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">Equipment details</div><CardTitle>{equipment.length} instruments</CardTitle></div>
    <div className="flex gap-2">{(["Expired", "Due soon", "Valid"] as const).filter((status) => counts[status]).map((status) => <Badge key={status} variant={STATUS[status]}>{counts[status]} {status.toLowerCase()}</Badge>)}</div></CardHeader>
    <CardContent>
      <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full border-collapse text-sm">
        <thead className="form-band"><tr className="text-left text-[10px] font-bold uppercase tracking-[.1em]"><th className="px-3 py-2">Instrument</th><th className="px-3 py-2">Model</th><th className="px-3 py-2">Serial</th><th className="px-3 py-2">Calibration due</th><th className="px-3 py-2">Status</th></tr></thead>
        <tbody>{equipment.map((item) => {
          const status = calibrationStatus(item, state.demoDate);
          return <tr key={`${item.id}-${item.calibrationDue}`} className={`border-t border-line ${saved === item.id ? "row-glow" : ""}`}>
            <td className="px-3 py-2"><span className="flex items-center gap-2 font-semibold text-navy"><Gauge className="size-4 text-slate-400" aria-hidden="true" />{item.kind}</span></td>
            <td className="tally-mono px-3 py-2 text-slate-600">{item.model}</td>
            <td className="tally-mono px-3 py-2 text-slate-600">{item.serial}</td>
            <td className="px-3 py-2">{canEdit ? <Input type="date" aria-label={`${item.kind} calibration due`} className="h-9 w-[160px]" defaultValue={item.calibrationDue} onBlur={(event) => { if (event.currentTarget.value !== item.calibrationDue) recordCalibration(item.id, event.currentTarget.value); }} /> : <span className="tally-mono">{formatDate(item.calibrationDue)}</span>}</td>
            <td className="px-3 py-2"><Badge variant={STATUS[status]}>{status}</Badge></td>
          </tr>;
        })}</tbody>
      </table></div>
      {canEdit ? <p className="mt-3 text-xs text-slate-500">Change a due date to record a new calibration. Instruments due within 30 days also appear in Alerts.</p> : <p className="mt-3 text-xs text-slate-500">Switch to Admin or Manager to record a calibration.</p>}
    </CardContent>
  </Card>;
}
