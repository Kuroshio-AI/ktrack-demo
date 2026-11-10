"use client";

import { useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, Factory, Plus, RefreshCw, Send, ShieldCheck, Trash2, X } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { PANE, usePanes } from "@/components/interior/panes";
import { RollingNumber } from "@/components/interior/value-flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { submitInspection, updateInspection } from "@/lib/domain";
import { createLot, deleteLot, lotTitle, nextLotNo, refreshLotSpec, reissueLot } from "@/lib/gex";
import { alloyLabel, checkLot, GEX_FINISHES, limitText, type GexGroup, type LotRow } from "@/lib/gex-check";
import type { GexCheck, GexFinish, GexLot, Inspection, InspectionStatus } from "@/lib/types";

const STATUS_BADGE: Record<InspectionStatus, "warning" | "success" | "danger" | "outline"> = { Draft: "outline", Submitted: "warning", Returned: "danger", Approved: "success", Issued: "success" };
const GROUPS: GexGroup[] = ["Composition", "Mechanical", "Electrical", "Finish"];
const isOpen = (status: InspectionStatus) => status === "Draft" || status === "Submitted" || status === "Returned";

function NewLot({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const { state, update } = useApp();
  const alloys = state.alloys ?? [];
  const [form, setForm] = useState({ lotNo: nextLotNo(state), customer: "", orderNo: "", customerPo: "", deliveryNote: "", profile: "", alloyId: alloys[0]?.id ?? "", finish: "Mill" as GexFinish, colour: "", lengthMm: "6000", quantity: "", castNo: "", inspector: "Priya Nair" });
  const [error, setError] = useState("");
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [field]: event.target.value }));
  function create() {
    try {
      const result = createLot(state, { ...form, lengthMm: Number(form.lengthMm), quantity: Number(form.quantity) });
      if (update(() => result.state)) onCreated(result.inspection.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The lot could not be recorded."); }
  }
  const field = (id: keyof typeof form, label: string, props: Record<string, unknown> = {}) => <div><label className="eyebrow" htmlFor={`lot-${id}`}>{label}</label><Input id={`lot-${id}`} className="mt-1.5" value={form[id]} onChange={set(id)} {...props} /></div>;
  return <div className="animate-rise mt-4 rounded-xl border border-[#e9c9ae] bg-[#fffaf5] p-4">
    <datalist id="lot-customers">{[...new Set(state.records.map((record) => record.owner))].map((owner) => <option key={owner} value={owner} />)}</datalist>
    <div className="grid grid-cols-2 gap-3">
      {field("lotNo", "Lot no.")}
      {field("customer", "Customer", { list: "lot-customers", placeholder: "Customer name" })}
      {field("orderNo", "Sales order", { placeholder: "SO-…" })}
      {field("customerPo", "Customer PO")}
      {field("deliveryNote", "Delivery note", { placeholder: "DN-…" })}
      {field("profile", "Profile", { placeholder: "SEC-…" })}
      <div><label className="eyebrow" htmlFor="lot-alloy">Alloy-temper</label><Select id="lot-alloy" className="mt-1.5" value={form.alloyId} onChange={set("alloyId")}>{alloys.map((alloy) => <option key={alloy.id} value={alloy.id}>{alloyLabel(alloy)}</option>)}</Select></div>
      <div><label className="eyebrow" htmlFor="lot-finish">Finish</label><Select id="lot-finish" className="mt-1.5" value={form.finish} onChange={set("finish")}>{GEX_FINISHES.map((finish) => <option key={finish}>{finish}</option>)}</Select></div>
      {form.finish !== "Mill" && field("colour", "Colour", { placeholder: "Satin white…" })}
      {field("lengthMm", "Length (mm)", { type: "number", min: 1 })}
      {field("quantity", "Quantity (pcs)", { type: "number", min: 1 })}
      {field("castNo", "Cast no.", { placeholder: "C-…" })}
      {field("inspector", "Inspector")}
    </div>
    {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
    <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button className="press" onClick={create} disabled={!alloys.length}><Plus data-icon="inline-start" />Record lot</Button></div>
  </div>;
}

// One result. The flag follows the text as it is typed; the value is saved on blur, and a blank removes it.
function ReadingRow({ lot, row, disabled, onSave }: { lot: GexLot; row: LotRow; disabled: boolean; onSave: (key: string, value?: number) => void }) {
  const shown = row.value === undefined ? "" : String(row.value);
  const [text, setText] = useState(shown);
  const typed = text.trim() ? Number(text.replace(",", ".")) : undefined;
  const valid = typed === undefined || Number.isFinite(typed);
  const ok = typed === undefined || !valid ? undefined : checkLot({ ...lot, readings: { [row.key]: typed } }).rows.find((item) => item.key === row.key)?.ok;
  const below = ok === false && row.min !== undefined && typed! < row.min;
  const flag = ok === false ? (below ? "Below min" : "Above max") : !valid ? "Not a number" : undefined;
  // The unit sits inside the box and the verdict right after it, so the whole row reads in one line at any pane width.
  return <tr className="border-t border-line">
    <td className="px-3 py-1.5 font-semibold text-navy">{row.label}</td>
    <td className="form-limits tally-mono whitespace-nowrap px-3 py-1.5 text-right">{limitText(row)}</td>
    <td className="px-2 py-1"><div className="relative"><Input data-result aria-label={`${row.label} result, ${row.unit}`} aria-invalid={ok === false || !valid} aria-describedby={flag ? `${row.key}-flag` : undefined} inputMode="decimal" value={text} readOnly={disabled} onChange={(event) => setText(event.target.value)} onFocus={(event) => event.target.select()}
      onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); const all = [...document.querySelectorAll<HTMLInputElement>("input[data-result]:not([readonly])")]; all[all.indexOf(event.currentTarget) + 1]?.focus() ?? event.currentTarget.blur(); }}
      onBlur={() => { if (text.trim() === shown) return; if (!valid) return setText(shown); onSave(row.key, typed); }}
      className={`tally-mono h-9 pr-12 text-right read-only:cursor-default ${ok === false || !valid ? "border-danger font-semibold text-danger" : "text-navy"}`} /><span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-slate-400">{row.unit}</span></div></td>
    <td className="w-8 py-1.5 pr-3">{flag ? <span id={`${row.key}-flag`} title={flag} className="grid size-6 place-items-center rounded-full bg-[#fde8e8] text-danger"><AlertTriangle className="size-3.5" aria-label={flag} /></span> : ok ? <Check className="size-4 text-success" strokeWidth={3} aria-label="In range" /> : null}</td>
  </tr>;
}

function LotHeader({ lot, assetRef }: { lot: GexLot; assetRef: string }) {
  const cells: [string, string][] = [["Lot", assetRef], ["Customer", lot.customer], ["Sales order", lot.orderNo], ["Customer PO", lot.customerPo], ["Delivery note", lot.deliveryNote], ["Profile", lot.profile], ["Alloy-temper", alloyLabel(lot.spec)], ["Finish", lot.colour ? `${lot.finish} · ${lot.colour}` : lot.finish], ["Length", `${lot.lengthMm} mm`], ["Quantity", `${lot.quantity} pcs`], ["Cast", lot.castNo]];
  return <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-line sm:grid-cols-4 xl:grid-cols-6">{cells.map(([label, value]) => <div key={label} className="-mb-px -mr-px border-b border-r border-line px-3 py-2"><dt className="eyebrow">{label}</dt><dd className="mt-0.5 text-sm font-semibold text-navy">{value}</dd></div>)}</dl>;
}

export function LotView() {
  const { state, update } = useApp();
  const panes = usePanes();
  const lots = state.inspections.filter((inspection) => inspection.lot);
  // The dashboard links here with ?lot=; otherwise the first lot still in test.
  const lotParam = useSearchParams().get("lot");
  const selected = lots.find((item) => item.id === lotParam) ?? lots.find((item) => item.status === "Draft" || item.status === "Returned") ?? lots[0];
  const select = (id?: string) => window.history.replaceState(null, "", id ? `?lot=${id}` : "/inspections");
  const [creating, setCreating] = useState(false);
  const record = state.records.find((item) => item.id === selected?.assetId);
  const certificate = record?.certificates.find((item) => item.id === selected?.certificateId);
  const canWork = state.role === "Admin" || state.role === "Engineer";
  const canEdit = canWork && (selected?.status === "Draft" || selected?.status === "Returned");
  const lot = selected?.lot;
  const check = lot ? checkLot(lot) : undefined;
  const current = lot && state.alloys?.find((item) => item.id === lot.spec.id);
  const stale = canEdit && current && JSON.stringify(current) !== JSON.stringify(lot!.spec);
  // A reissue leaves the old lot Issued; its certificate is what shows it was replaced.
  const superseded = certificate?.status === "Superseded";
  const lotCount = new Set(lots.map((item) => item.assetId)).size;
  const reissuable = canWork && selected?.status === "Issued" && !superseded && !lots.some((item) => item.assetId === selected.assetId && isOpen(item.status));

  const changeLot = (change: (lot: GexLot) => GexLot) => { if (selected) update((current) => { const item = current.inspections.find((inspection) => inspection.id === selected.id); return item?.lot ? updateInspection(current, item.id, { lot: change(item.lot) }) : current; }); };
  const saveReading = (key: string, value?: number) => changeLot((item) => { const readings = { ...item.readings }; if (value === undefined) delete readings[key]; else readings[key] = value; return { ...item, readings }; });
  const saveCheck = (key: GexCheck, value: boolean) => changeLot((item) => { const checks = { ...item.checks }; if (checks[key] === value) delete checks[key]; else checks[key] = value; return { ...item, checks }; });
  function submit() {
    if (!selected || !check) return;
    if (check.failed.length && !window.confirm(`${check.failed.length} result${check.failed.length === 1 ? " is" : "s are"} outside the limits. The reviewer cannot issue a certificate until ${check.failed.length === 1 ? "it is" : "they are"} retested.`)) return;
    flushSync(() => update((current) => submitInspection(current, selected.id)));
  }
  function removeDraft(inspection: Inspection) {
    if (!window.confirm(`Delete the draft lot ${record?.assetRef ?? ""}? Its results will be lost. This can't be undone.`)) return;
    if (update((current) => deleteLot(current, inspection.id))) select(undefined);
  }
  function reissue() {
    if (!selected || !window.confirm("Reissue this lot's certificate? The current certificate will be superseded when the new one is approved.")) return;
    // Built here, not inside update, so the new draft's id can be selected.
    try { const result = reissueLot(state, selected.assetId); if (update(() => result.state)) select(result.inspection.id); }
    catch (reason) { window.alert(reason instanceof Error ? reason.message : "The lot could not be reissued."); }
  }
  const entered = check ? check.rows.filter((row) => row.value !== undefined).length : 0;
  const answered = check ? check.checks.filter((item) => item.value !== undefined).length : 0;

  return <div ref={panes} className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
    <Card className={PANE}><CardHeader className="flex-row items-start justify-between gap-3"><div><div className="eyebrow">Production lots</div><CardTitle>{lotCount} lot{lotCount === 1 ? "" : "s"}</CardTitle></div>{canWork && !creating && <Button className="press" onClick={() => setCreating(true)}><Plus data-icon="inline-start" />New lot</Button>}</CardHeader>
      <CardContent>
        {lots.length ? <div className="stagger flex flex-col gap-1">{lots.map((inspection) => {
          const lotRecord = state.records.find((item) => item.id === inspection.assetId);
          const ref = lotRecord?.assetRef ?? "Unknown lot";
          const failed = checkLot(inspection.lot!).failed.length;
          const superseded = lotRecord?.certificates.find((item) => item.id === inspection.certificateId)?.status === "Superseded";
          return <button key={inspection.id} type="button" onClick={() => select(inspection.id)} className={`focus-ring grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-lg px-3 py-2.5 text-left text-sm ${inspection.id === selected?.id ? "bg-[#e8f3f8]" : "[@media(hover:hover)]:hover:bg-paper"}`}>
            <span className="tally-mono whitespace-nowrap font-semibold text-navy">{ref}</span>
            <Badge variant={superseded ? "outline" : STATUS_BADGE[inspection.status]}>{superseded ? "Superseded" : inspection.status}</Badge>
            {/* Out of range rides on the detail line, so the lot no. and status keep one line in the narrow list. */}
            <span className="col-span-2 truncate text-xs text-slate-500">{failed > 0 && <span className="font-semibold text-danger">{failed} out of range · </span>}{inspection.lot!.customer} · {lotTitle(inspection.lot!)}</span>
          </button>;
        })}</div> : <p className="text-sm text-slate-500">No lots yet. Record one to start entering its results.</p>}
        {creating && <NewLot onCreated={(id) => { select(id); setCreating(false); }} onCancel={() => setCreating(false)} />}
        {!canWork && <p className="mt-3 text-xs text-slate-500">Switch to Engineer or Admin to record a lot or enter results.</p>}
      </CardContent>
    </Card>

    {selected && record && lot && check ? <Card className={PANE}>
      <CardHeader className="gap-4 border-b border-line">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">Production lot · {record.assetRef}</div><CardTitle className="mt-1">{lotTitle(lot)}</CardTitle><p className="mt-1 text-sm text-slate-500">{lot.spec.sample && "Sample limits · "}Inspector: {selected.inspector}</p></div><Badge variant={STATUS_BADGE[selected.status]}>{selected.status}</Badge></div>
        <LotHeader lot={lot} assetRef={record.assetRef} />
        <div className="stagger grid grid-cols-3 gap-2">{([["Results entered", `${entered}/${check.rows.length}`, "text-navy"], ["Out of range", check.failed.length, check.failed.length ? "text-danger" : "text-success"], ["Checks answered", `${answered}/${check.checks.length}`, answered < check.checks.length ? "text-[#8a5d00]" : "text-navy"]] as const).map(([label, value, tone]) => <div key={label} className="rounded-lg border border-line bg-white px-3 py-2"><span className="eyebrow">{label}</span><span className={`tally-mono mt-0.5 block text-2xl font-semibold ${tone}`}>{typeof value === "number" ? <RollingNumber value={value} /> : value}</span></div>)}</div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-5">
        {stale && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#b8cedc] bg-[#eef7fb] px-4 py-3 text-sm text-navy"><span className="min-w-0 flex-1">The {alloyLabel(lot.spec)} limits have changed since this lot was recorded.</span><Button variant="outline" size="sm" className="press" onClick={() => update((current) => refreshLotSpec(current, selected.id))}><RefreshCw data-icon="inline-start" />Use current limits</Button></div>}
        <fieldset><legend className="eyebrow">Finish checks</legend><div className="mt-2 flex flex-col divide-y divide-line rounded-lg border border-line">{check.checks.map((item) => <div key={item.key} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"><span className="min-w-0 flex-1 font-semibold text-navy">{item.label}</span>
          {([[true, "OK", "border-success bg-success text-white"], [false, "Not OK", "border-danger bg-danger text-white"]] as const).map(([value, label, on]) => <button key={label} type="button" aria-pressed={item.value === value} disabled={!canEdit} onClick={() => saveCheck(item.key, value)} className={`press focus-ring inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold disabled:cursor-default ${item.value === value ? on : "border-line bg-white text-slate-600 [@media(hover:hover)]:hover:border-[#b8cedc]"}`}>{item.value === value && (value ? <Check className="size-3" strokeWidth={3} aria-hidden="true" /> : <X className="size-3" strokeWidth={3} aria-hidden="true" />)}{label}</button>)}
        </div>)}</div></fieldset>
        {GROUPS.map((group) => { const rows = check.rows.filter((row) => row.group === group); return rows.length > 0 && <div key={group} className="overflow-x-auto rounded-xl border border-line"><table className="w-full table-fixed border-collapse text-sm">
          <thead className="form-band"><tr className="text-left text-[10px] font-bold uppercase tracking-[.1em]"><th className="px-3 py-2">{group}</th><th className="w-[30%] px-3 py-2 text-right">Limit</th><th className="w-[34%] px-3 py-2">Result</th><th className="w-8 py-2 pr-3"><span className="sr-only">Check</span></th></tr></thead>
          <tbody>{rows.map((row) => <ReadingRow key={`${selected.id}-${row.key}-${row.value ?? ""}`} lot={lot} row={row} disabled={!canEdit} onSave={saveReading} />)}</tbody>
        </table></div>; })}
        <div><label className="eyebrow" htmlFor="lot-notes">Notes</label><Textarea id="lot-notes" className="mt-1.5" defaultValue={selected.notes} key={selected.id} disabled={!canEdit} onBlur={(event) => { if (event.currentTarget.value !== selected.notes) update((current) => updateInspection(current, selected.id, { notes: event.currentTarget.value })); }} placeholder="Sampling, retests, anything the reviewer should know…" /></div>
        {selected.reviewerComment && selected.status === "Returned" && <div className="flex gap-2 rounded-lg border border-[#f0c2c3] bg-[#fff6f6] px-3 py-3 text-sm text-danger"><X className="mt-0.5 size-4 shrink-0" /><span><strong>Returned for retest.</strong> {selected.reviewerComment}</span></div>}
        <div className="border-t border-line pt-4" aria-live="polite">{selected.status === "Submitted" ? <div className="animate-rise flex flex-wrap items-center gap-3 rounded-lg border border-success/25 bg-success/[.06] px-4 py-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-success text-white"><Check className="draw-check size-5" strokeWidth={3} aria-hidden="true" /></span><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-navy">Sent for sign-off</div><div className="text-xs text-slate-600">A reviewer approves it in Approvals, and it is issued as a numbered quality certificate with a QR.</div></div><Button asChild size="sm"><Link href="/approvals">Open Approvals<ArrowRight data-icon="inline-end" /></Link></Button></div>
          : selected.status === "Issued" ? <div className="animate-rise flex flex-wrap items-center gap-3 rounded-lg border border-success/25 bg-success/[.06] px-4 py-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-success text-white"><ShieldCheck className="size-5" aria-hidden="true" /></span><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-navy">{superseded ? "Certificate superseded" : "Certificate issued"}{certificate && ` · ${certificate.number}`}</div><div className="text-xs text-slate-600">{superseded ? "A reissued certificate replaced this one." : "Print it or show its QR from Certificates."}</div></div>{reissuable && <Button variant="outline" size="sm" className="press" onClick={reissue}><RefreshCw data-icon="inline-start" />Reissue certificate</Button>}<Button asChild size="sm"><Link href="/certificates">Open Certificates<ArrowRight data-icon="inline-end" /></Link></Button></div>
          : <div className="flex flex-wrap items-center justify-end gap-2">{canWork && selected.status === "Draft" && <Button variant="ghost" className="press mr-auto text-slate-500 hover:bg-[#fff3f3] hover:text-danger" onClick={() => removeDraft(selected)}><Trash2 data-icon="inline-start" />Delete draft</Button>}{check.failed.length > 0 && <span className="inline-flex items-center gap-1 text-xs text-danger"><AlertTriangle className="size-3.5" />{check.failed.length} out of range</span>}{check.pending > 0 && <span className="text-xs text-slate-500">{check.pending} result{check.pending === 1 ? "" : "s"} still to enter</span>}<Button className="press" onClick={submit} disabled={!canEdit || !check.complete}><Send data-icon="inline-start" />Submit for sign-off</Button></div>}</div>
      </CardContent>
    </Card> : <Card><CardContent className="flex min-h-[320px] flex-col items-center justify-center p-8 text-center"><Factory className="size-10 text-[#b8cedc]" /><h2 className="mt-4 font-semibold text-navy">Open a lot</h2><p className="mt-2 max-w-sm text-sm text-slate-500">Choose a lot, or record a new one. Every result is checked against its alloy-temper&apos;s limits as you type.</p></CardContent></Card>}
  </div>;
}
