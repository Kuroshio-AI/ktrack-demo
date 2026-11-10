"use client";

import { useState } from "react";
import { Info, Save } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { updateAlloy } from "@/lib/gex";
import { alloyLabel, GEX_READINGS, limitText, type GexGroup } from "@/lib/gex-check";
import type { AlloySpec, Limit } from "@/lib/types";

const GROUPS: GexGroup[] = ["Composition", "Mechanical", "Electrical", "Finish"];
type Draft = Record<string, { min: string; max: string }>;
const toDraft = (spec: AlloySpec): Draft => Object.fromEntries(GEX_READINGS.map(({ key }) => { const limit = spec.limits.find((item) => item.column === key); return [key, { min: limit?.min === undefined ? "" : String(limit.min), max: limit?.max === undefined ? "" : String(limit.max) }]; }));
const toNumber = (text: string) => text.trim() ? Number(text.replace(",", ".")) : undefined;
// Compared as numbers, so "0.30" against a saved 0.3 is not a change.
const asNumbers = (draft: Draft) => JSON.stringify(Object.values(draft).map(({ min, max }) => [toNumber(min), toNumber(max)]));

// One alloy-temper's limits, edited as a whole and saved together, so a half-typed min/max pair is never checked against.
function AlloyLimits({ spec, canEdit }: { spec: AlloySpec; canEdit: boolean }) {
  const { update } = useApp();
  const [draft, setDraft] = useState(() => toDraft(spec));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const changed = asNumbers(draft) !== asNumbers(toDraft(spec));
  const set = (key: string, side: "min" | "max", value: string) => { setSaved(false); setDraft((current) => ({ ...current, [key]: { ...current[key], [side]: value } })); };
  function save() {
    setError("");
    const limits: Limit[] = Object.entries(draft).map(([column, { min, max }]) => ({ column, min: toNumber(min), max: toNumber(max) }));
    const bad = GEX_READINGS.find(({ key }) => [draft[key].min, draft[key].max].some((text) => text.trim() && !Number.isFinite(toNumber(text))));
    if (bad) return setError(`${bad.label}: enter a number, or leave it blank for no limit.`);
    try { if (update((current) => updateAlloy(current, spec.id, limits))) setSaved(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The limits could not be saved."); }
  }
  return <Card><CardHeader className="flex-row flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">Alloy-temper</div><CardTitle>{alloyLabel(spec)}</CardTitle></div>{spec.sample && <Badge variant="warning">Sample limits</Badge>}</CardHeader>
    <CardContent className="flex flex-col gap-4">
      {GROUPS.map((group) => <div key={group} className="overflow-x-auto rounded-xl border border-line"><table className="w-full min-w-[560px] table-fixed border-collapse text-sm">
        <thead className="form-band"><tr className="text-left text-[10px] font-bold uppercase tracking-[.1em]"><th className="px-3 py-2">{group}</th><th className="w-[80px] px-3 py-2">Unit</th><th className="w-[120px] px-3 py-2">Min</th><th className="w-[120px] px-3 py-2">Max</th><th className="w-[130px] px-3 py-2 text-right">Limit</th></tr></thead>
        <tbody>{GEX_READINGS.filter((reading) => reading.group === group).map((reading) => { const row = draft[reading.key]; const shown = { min: toNumber(row.min), max: toNumber(row.max) }; return <tr key={reading.key} className="border-t border-line">
          <td className="px-3 py-1.5"><div className="font-semibold text-navy">{reading.label}</div>{reading.finish && <div className="text-[11px] text-slate-500">{reading.finish} only</div>}</td>
          <td className="px-3 py-1.5 text-slate-500">{reading.unit}</td>
          {(["min", "max"] as const).map((side) => <td key={side} className="px-2 py-1"><Input aria-label={`${reading.label} ${side}`} inputMode="decimal" placeholder="—" value={row[side]} readOnly={!canEdit} onChange={(event) => set(reading.key, side, event.target.value)} className="tally-mono h-8 w-[100px] text-right read-only:cursor-default" /></td>)}
          <td className="tally-mono px-3 py-1.5 text-right text-slate-500">{[shown.min, shown.max].every((value) => value === undefined || Number.isFinite(value)) ? limitText(shown) === "—" ? "Not tested" : limitText(shown) : "—"}</td>
        </tr>; })}</tbody>
      </table></div>)}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {canEdit ? <div className="flex flex-wrap items-center justify-end gap-2">{saved && !changed && <span className="text-xs text-success">Saved. New lots use these limits.</span>}{changed && <Button variant="ghost" onClick={() => { setDraft(toDraft(spec)); setError(""); }}>Discard</Button>}<Button className="press" onClick={save} disabled={!changed}><Save data-icon="inline-start" />Save limits</Button></div>
        : <p className="text-xs text-slate-500">Switch to Admin or Manager to change a limit.</p>}
    </CardContent>
  </Card>;
}

export function AlloysView() {
  const { state } = useApp();
  const alloys = state.alloys ?? [];
  const [chosen, setChosen] = useState(alloys[0]?.id);
  const spec = alloys.find((item) => item.id === chosen) ?? alloys[0];
  const canEdit = state.role === "Admin" || state.role === "Manager";
  return <div className="flex flex-col gap-5">
    <div className="flex gap-3 rounded-lg border border-[#b8cedc] bg-[#eef7fb] px-4 py-3 text-sm text-navy"><Info className="mt-0.5 size-4 shrink-0" /><p>Sample limits, invented for this demo. Replace them with your own before relying on a check. Lots keep the limits they were recorded with; drafts can switch to the current ones.</p></div>
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Alloy-temper">{alloys.map((alloy) => <button key={alloy.id} type="button" aria-pressed={alloy.id === spec?.id} onClick={() => setChosen(alloy.id)} className={`press focus-ring inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold ${alloy.id === spec?.id ? "border-navy bg-navy text-white" : "border-line bg-white text-slate-600 [@media(hover:hover)]:hover:border-[#b8cedc]"}`}>{alloyLabel(alloy)}</button>)}</div>
    {spec ? <AlloyLimits key={spec.id} spec={spec} canEdit={canEdit} /> : <p className="text-sm text-slate-500">No alloy-tempers yet. Reset the demo to load the sample limits.</p>}
  </div>;
}
