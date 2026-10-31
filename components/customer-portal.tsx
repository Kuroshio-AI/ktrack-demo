"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { OfflineBanner } from "@/components/offline";
import { TallyReportDialog } from "@/components/tally-report";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AMS_NAME } from "@/lib/client";
import { customerShipments, shipmentTotals, type Shipment } from "@/lib/customer";
import { qrFor } from "@/lib/qr";
import { connectionLabel, FINAL_CLASSES } from "@/lib/tally";
import type { CertificateStatus, FinalClass } from "@/lib/types";
import { formatDate } from "@/lib/utils";

// What a customer account sees instead of the operations screens: how each shipment of their pipe was classed, and its
// report. Read only.

// Run through the dataviz palette check in the bar's order, FINAL_CLASSES (light surface, worst neighbouring pair ΔE 9.1
// colour-blind, 22.9 normal); yellow and aqua sit under 3:1, so every class is also named with its count beside the bar.
const CLASS_COLOR: Record<FinalClass, string> = {
  "Class 1 (New)": "#1baf7a", "Premium-Accepted": "#008300", "Class 1-Rework": "#eda100", "Premium-Rework": "#2a78d6", "Class-2": "#eb6834", Bent: "#6250d6", Scrap: "#e34948",
};
const STATUS: Record<CertificateStatus, { label: string; variant: "success" | "warning" | "outline" | "danger" }> = {
  Valid: { label: "Current", variant: "success" }, Expired: { label: "Expired", variant: "warning" }, Superseded: { label: "Superseded", variant: "outline" }, Revoked: { label: "Revoked", variant: "danger" },
};
const share = (count: number, total: number) => total ? Math.round((count / total) * 100) : 0;
const pipes = (count: number) => `${count} pipe${count === 1 ? "" : "s"}`;

// One stacked bar: a segment per class, 2px apart, in grading order from new pipe to scrap.
function ClassBar({ classes, total, large = false }: { classes: Record<FinalClass, number>; total: number; large?: boolean }) {
  const [hover, setHover] = useState<FinalClass>();
  const shown = FINAL_CLASSES.filter((cls) => classes[cls] > 0);
  const before = (cls: FinalClass) => shown.slice(0, shown.indexOf(cls)).reduce((sum, item) => sum + classes[item], 0);
  if (!total) return <div className={`w-full rounded bg-slate-100 ${large ? "h-9" : "h-2.5"}`} />;
  return <div className="relative">
    <div role="img" aria-label={`${pipes(total)}: ${shown.map((cls) => `${cls} ${classes[cls]}`).join(", ")}`} className={`flex w-full gap-[2px] ${large ? "h-9" : "h-2.5"}`}>
      {shown.map((cls) => <div key={cls} onPointerEnter={() => setHover(cls)} onPointerLeave={() => setHover(undefined)} className="h-full min-w-[3px] first:rounded-l last:rounded-r" style={{ flexGrow: classes[cls], backgroundColor: CLASS_COLOR[cls] }} />)}
    </div>
    {hover && large && <div className="pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-navy px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg" style={{ left: `${((before(hover) + classes[hover] / 2) / total) * 100}%` }}>
      {hover} · {pipes(classes[hover])} ({share(classes[hover], total)}%)
    </div>}
  </div>;
}

function Legend({ classes, total }: { classes: Record<FinalClass, number>; total: number }) {
  return <ul className="mt-5 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
    {FINAL_CLASSES.map((cls) => <li key={cls} className={`flex items-center gap-2 text-sm ${classes[cls] ? "text-navy" : "text-slate-400"}`}>
      <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: classes[cls] ? CLASS_COLOR[cls] : "#cbd5e1" }} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{cls}</span>
      <span className="font-mono font-semibold tabular-nums">{classes[cls]}</span>
      <span className="w-10 text-right font-mono text-xs tabular-nums text-slate-500">{share(classes[cls], total)}%</span>
    </li>)}
  </ul>;
}

const Tile = ({ label, value, detail }: { label: string; value: string; detail: string }) => <Card><CardContent className="p-5">
  <div className="eyebrow">{label}</div>
  <div className="mt-2 text-3xl font-bold tabular-nums tracking-[-.05em] text-navy">{value}</div>
  <div className="mt-1 text-xs text-slate-500">{detail}</div>
</CardContent></Card>;

const place = (item: Shipment) => [item.record.site, item.inspection.job?.well].filter(Boolean).join(" · ");

export function CustomerPortal() {
  const { state, user, signOut, saveError } = useApp();
  const [report, setReport] = useState<{ id: string; qr?: string }>();
  const shipments = customerShipments(state);
  const issued = shipments.filter((item) => item.certificate);
  const measuring = shipments.filter((item) => !item.certificate);
  const latest = issued.find((item) => item.status === "Valid" || item.status === "Expired") ?? issued[0];
  const totals = shipmentTotals(shipments);
  // The QR comes from the server, so it appears a moment after the report opens; offline the report opens without one.
  function show({ inspection, record, certificate, status }: Shipment) {
    setReport({ id: inspection.id });
    if (certificate && status) void qrFor({ certificateNo: certificate.number, assetRef: record.assetRef, assetType: record.assetType, issuedDate: certificate.issuedDate, expiryDate: certificate.expiryDate, status })
      .then(({ image }) => setReport((current) => current?.id === inspection.id ? { ...current, qr: image } : current), () => undefined);
  }
  const open = (item: Shipment) => <Button size="sm" variant="outline" className="press" onClick={() => show(item)}><FileText className="size-3.5" aria-hidden="true" />Open report</Button>;

  return <div className="min-h-screen bg-paper">
    <header className="bg-[#0b3151] text-white print-hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[#0b3151] shadow-lg"><span className="text-xl font-black">K</span></span>
          <span className="min-w-0"><span className="block text-[19px] font-bold tracking-[-.03em]">KTrack</span><span className="block truncate text-[10px] font-bold uppercase tracking-[.15em] text-[#a8c7dd]">{AMS_NAME}</span></span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden max-w-[200px] truncate text-right text-sm font-semibold text-[#d6e7f1] sm:block">{user?.name}</span>
          <Button size="sm" variant="outline" className="press border-[#467493] bg-transparent text-white hover:bg-white/10" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <div className="eyebrow">Inspection results</div>
      <h1 className="mt-1 text-2xl font-bold tracking-[-.03em] text-navy sm:text-3xl">{user?.customer ?? "Your shipments"}</h1>
      <p className="mb-7 mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">Every shipment of drill pipe {AMS_NAME} has inspected for you, how each pipe was classed and the report issued for it. Classes appear once a report is issued.</p>
      <OfflineBanner />
      {saveError && <div role="alert" className="mb-5 rounded-lg border border-[#f0c2c3] bg-[#fff3f3] p-4 text-sm text-danger">{saveError}</div>}

      {!shipments.length ? <Card><CardContent className="p-8 text-center text-sm text-slate-600">No shipments yet. Your first one shows here as soon as its inspection starts.</CardContent></Card> : <div className="flex flex-col gap-6">
        {latest && <Card className="animate-rise">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="eyebrow">Latest shipment</div>
              <CardTitle className="mt-1">{latest.record.assetRef}</CardTitle>
              <p className="mt-1 text-sm text-slate-600">{[place(latest), latest.inspection.connection && connectionLabel(latest.inspection.connection), pipes(latest.total)].filter(Boolean).join(" · ")}</p>
              <p className="mt-0.5 text-xs text-slate-500">Report {latest.certificate!.number}, issued {formatDate(latest.date)}</p>
            </div>
            {open(latest)}
          </CardHeader>
          <CardContent>
            <ClassBar classes={latest.classes} total={latest.total} large />
            <Legend classes={latest.classes} total={latest.total} />
          </CardContent>
        </Card>}

        {totals.shipments > 0 && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Shipments inspected" value={String(totals.shipments)} detail={`with a current or expired report`} />
          <Tile label="Pipes inspected" value={String(totals.pipes)} detail="across those shipments" />
          <Tile label="Premium or new" value={`${share(totals.premium, totals.pipes)}%`} detail={`${pipes(totals.premium)} passed as Premium or Class 1`} />
          <Tile label="Scrapped" value={String(totals.classes.Scrap)} detail={`${share(totals.classes.Scrap, totals.pipes)}% of pipes inspected`} />
        </div>}

        {measuring.length > 0 && <Card>
          <CardHeader><div className="eyebrow">In inspection</div><CardTitle className="mt-1">Being measured now</CardTitle></CardHeader>
          <CardContent><ul className="flex flex-col gap-4">
            {measuring.map((item) => <li key={item.inspection.id} className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="min-w-[180px] flex-1"><div className="font-mono text-sm font-semibold text-navy">{item.record.assetRef}</div><div className="text-xs text-slate-500">{[place(item), `opened ${formatDate(item.date)}`].filter(Boolean).join(" · ")}</div></div>
              <div className="w-full max-w-[280px]"><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-accent" style={{ width: `${share(item.measured, item.total)}%` }} /></div><div className="mt-1 text-xs tabular-nums text-slate-500">{item.measured} of {pipes(item.total)} measured</div></div>
            </li>)}
          </ul></CardContent>
        </Card>}

        {issued.length > 0 && <Card>
          <CardHeader><div className="eyebrow">History</div><CardTitle className="mt-1">Every shipment</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead><tr className="border-b border-line text-[11px] font-bold uppercase tracking-[.08em] text-slate-500"><th className="py-2 pr-4 font-bold">Issued</th><th className="py-2 pr-4 font-bold">Work order</th><th className="py-2 pr-4 font-bold">Pipes</th><th className="w-[200px] py-2 pr-4 font-bold">Classes</th><th className="py-2 pr-4 text-right font-bold">Premium</th><th className="py-2 pr-4 text-right font-bold">Scrap</th><th className="py-2 font-bold">Report</th></tr></thead>
              <tbody>{issued.map((item) => <tr key={item.inspection.id} className="border-b border-line last:border-0">
                <td className="whitespace-nowrap py-3 pr-4 text-slate-600">{formatDate(item.date)}</td>
                <td className="py-3 pr-4"><div className="font-mono font-semibold text-navy">{item.record.assetRef}</div><div className="text-xs text-slate-500">{place(item)}</div></td>
                <td className="py-3 pr-4 font-mono tabular-nums">{item.total}</td>
                <td className="py-3 pr-4"><ClassBar classes={item.classes} total={item.total} /></td>
                <td className="py-3 pr-4 text-right font-mono tabular-nums">{share(item.classes["Premium-Accepted"] + item.classes["Class 1 (New)"], item.total)}%</td>
                <td className="py-3 pr-4 text-right font-mono tabular-nums">{item.classes.Scrap}</td>
                <td className="py-3"><div className="flex items-center gap-2"><span className="font-mono text-xs text-slate-600">{item.certificate!.number}</span>{item.status && <Badge variant={STATUS[item.status].variant}>{STATUS[item.status].label}</Badge>}{open(item)}</div></td>
              </tr>)}</tbody>
            </table>
          </CardContent>
        </Card>}
      </div>}
    </main>
    {report && <TallyReportDialog inspectionId={report.id} qr={report.qr} onClose={() => setReport(undefined)} />}
  </div>;
}
