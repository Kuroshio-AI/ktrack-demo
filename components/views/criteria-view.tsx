"use client";

import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { OUTCOME_TONE } from "@/components/tally-report";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { updateCriterion } from "@/lib/ams";
import { CODES, DAMAGE_OUTCOMES, SAMPLE_CRITERIA } from "@/lib/tally";
import type { DamageOutcome } from "@/lib/types";

// The damage criteria behind each condition code on the tally sheet: what the inspector looks for and what it does to the
// pipe. KTrack grades with the outcome, so changing one regrades every tally sheet still being filled in.
export function CriteriaView() {
  const { state, update } = useApp();
  const criteria = state.criteria ?? SAMPLE_CRITERIA;
  const canEdit = state.role === "Admin" || state.role === "Manager";
  const [saved, setSaved] = useState<string>();
  const [error, setError] = useState("");
  const open = state.inspections.filter((inspection) => inspection.job && (inspection.status === "Draft" || inspection.status === "Returned")).length;

  function change(code: string, patch: { criterion?: string; outcome?: DamageOutcome }) {
    setError("");
    try { if (update((current) => updateCriterion(current, code, patch))) setSaved(code); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The criterion could not be saved."); }
  }

  return <Card><CardHeader className="flex-row flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">Damage criteria</div><CardTitle>{criteria.length} condition codes</CardTitle></div>
    <div className="flex flex-wrap gap-1.5">{DAMAGE_OUTCOMES.filter((outcome) => criteria.some((item) => item.outcome === outcome)).map((outcome) => <span key={outcome} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${OUTCOME_TONE[outcome]}`}>{criteria.filter((item) => item.outcome === outcome).length} {outcome.toLowerCase()}</span>)}</div></CardHeader>
    <CardContent>
      <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full border-collapse text-sm">
        <thead className="form-band"><tr className="text-left text-[10px] font-bold uppercase tracking-[.1em]"><th className="px-3 py-2">Code</th><th className="px-3 py-2">Defect</th><th className="px-3 py-2">Criterion</th><th className="px-3 py-2">What it does to the pipe</th></tr></thead>
        <tbody>{criteria.map((item) => <tr key={`${item.code}-${item.outcome}-${item.criterion}`} className={`border-t border-line align-top ${saved === item.code ? "row-glow" : ""}`}>
          <td className="px-3 py-2.5"><span className={`tally-mono inline-block min-w-12 rounded-md px-2 py-1 text-center text-xs font-semibold ${OUTCOME_TONE[item.outcome]}`}>{item.code}</span></td>
          <td className="whitespace-nowrap px-3 py-2.5"><div className="font-semibold text-navy">{CODES[item.code] ?? item.code}</div>{item.sample && <div className="mt-0.5 text-[11px] font-medium text-[#8a5d00]">Sample wording</div>}</td>
          <td className="min-w-[280px] px-3 py-2">{canEdit
            ? <Textarea aria-label={`${item.code} criterion`} rows={2} className="min-h-0 resize-y py-1.5 text-sm" defaultValue={item.criterion} onBlur={(event) => { if (event.currentTarget.value.trim() !== item.criterion) change(item.code, { criterion: event.currentTarget.value }); }} />
            : <p className="py-0.5 text-slate-700">{item.criterion}</p>}</td>
          <td className="px-3 py-2">{canEdit
            ? <Select aria-label={`${item.code} outcome`} className="h-9 w-[150px]" value={item.outcome} onChange={(event) => change(item.code, { outcome: event.target.value as DamageOutcome })}>{DAMAGE_OUTCOMES.map((outcome) => <option key={outcome}>{outcome}</option>)}</Select>
            : <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${OUTCOME_TONE[item.outcome]}`}>{item.outcome}</span>}</td>
        </tr>)}</tbody>
      </table></div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <p className="mt-3 text-xs text-slate-500">{canEdit ? `Changing an outcome regrades the ${open} tally sheet${open === 1 ? "" : "s"} still being filled in. Submitted and issued reports keep the criteria they were graded with.` : "Switch to Admin or Manager to change a criterion."}{criteria.some((item) => item.sample) && " Rows marked Sample wording are made up for this demo; your procedure's criteria replace them."}</p>
    </CardContent>
  </Card>;
}
