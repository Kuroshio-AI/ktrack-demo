"use client";

import Link from "next/link";
import { ArrowUpRight, BellOff, Building2, CalendarClock, CircleAlert, ClipboardCheck, ClipboardList, FileClock, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { RollingNumber } from "@/components/interior/value-flash";
import { DigestCard } from "@/components/fls-panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IS_AMS, IS_FLS } from "@/lib/client";
import { dateDiffDays } from "@/lib/domain";
import { buildingStatus, type Light } from "@/lib/fls";
import { summarizeTally } from "@/lib/tally";
import { formatDate, formatDateTime, formatLocalDate } from "@/lib/utils";

function Kpi({ label, value, detail, icon: Icon, tone = "navy" }: { label: string; value: number; detail: string; icon: typeof CalendarClock; tone?: "navy" | "amber" | "red" | "green" }) {
  return <Card className="relative overflow-hidden"><div className={`absolute inset-x-0 top-0 h-1 ${tone === "amber" ? "bg-[#d99512]" : tone === "red" ? "bg-danger" : tone === "green" ? "bg-[#269663]" : "bg-accent"}`} /><CardContent className="p-5"><div className="eyebrow">{label}</div><div className="mt-2 flex items-center justify-between gap-3"><div className="text-3xl font-bold tracking-[-.06em] text-navy"><RollingNumber value={value} /></div><span className={`grid size-10 shrink-0 place-items-center rounded-lg ${tone === "amber" ? "bg-[#fff2d7] text-[#8a5d00]" : tone === "red" ? "bg-[#fde8e8] text-danger" : tone === "green" ? "bg-[#e7f4ed] text-[#187348]" : "bg-[#e8f3f8] text-accent"}`}><Icon className="size-5" /></span></div><div className="mt-1 text-xs text-slate-500">{detail}</div></CardContent></Card>;
}

// The FLS sheet's colours, counted: muted buildings sit apart so they never inflate the red count.
function FlsKpis() {
  const { state } = useApp();
  const statuses = state.records.map((record) => buildingStatus(record, state.demoDate));
  const count = (light: Light) => statuses.filter((status) => !status.muted && status.light === light).length;
  return <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Kpi label="Buildings" value={state.records.length} detail="tracked" icon={Building2} /><Kpi label="Green" value={count("green")} detail="15+ days to due date" icon={ShieldCheck} tone="green" /><Kpi label="Amber" value={count("amber")} detail="due within 14 days" icon={CalendarClock} tone="amber" /><Kpi label="Red" value={count("red")} detail="due date passed or expired" icon={ShieldAlert} tone="red" /><Kpi label="Muted" value={statuses.filter((status) => status.muted).length} detail="no alerts sent" icon={BellOff} /></div>;
}

// Where the inspection work stands: sheets still being measured, waiting for a reviewer, issued, and what was rejected.
function AmsKpis() {
  const { state } = useApp();
  const tallies = state.inspections.filter((inspection) => inspection.joints && inspection.connection);
  const issued = tallies.filter((inspection) => inspection.status === "Issued");
  const rejected = issued.reduce((total, inspection) => total + summarizeTally(inspection.connection!, inspection.joints!).reject, 0);
  return <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Kpi label="Tally sheets open" value={tallies.filter((inspection) => inspection.status === "Draft" || inspection.status === "Returned").length} detail="being measured" icon={ClipboardList} /><Kpi label="Waiting for approval" value={tallies.filter((inspection) => inspection.status === "Submitted").length} detail="in Approvals" icon={FileClock} tone="amber" /><Kpi label="Reports issued" value={issued.length} detail="numbered, with QR" icon={ShieldCheck} tone="green" /><Kpi label="Joints rejected" value={rejected} detail="on issued reports" icon={ShieldX} tone="red" /></div>;
}

export function DashboardView() {
  const { state } = useApp();
  const open = state.alerts.filter((alert) => alert.status === "open");
  const overdue = open.filter((alert) => alert.tier === "overdue").length;
  const due7 = open.filter((alert) => alert.tier === "due7" || alert.tier === "today").length;
  const due30 = open.filter((alert) => ["due30", "due7", "today"].includes(alert.tier ?? "")).length;
  const review = state.inspections.filter((inspection) => inspection.status === "Submitted").length;
  // Not Ok items from an approved PPM checklist have no due date, so they sort first.
  const todayActions = open.filter((alert) => ["due7", "today", "overdue"].includes(alert.tier ?? "") || (alert.occurrenceKey.startsWith("defects:") && !alert.acknowledgedAt)).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")).slice(0, 6);
  return <div className="flex flex-col gap-6">
    {state.records.length === 0 && !IS_AMS && <Card><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="font-semibold text-navy">Your register is ready to set up.</h2><p className="mt-1 text-sm text-slate-500">{IS_FLS ? "Import your FLS DCD tracker to see every building's status and alerts." : "Import a spreadsheet to see deadlines and alerts. Templates and sample data are in Demo Controls."}</p></div>
      <div className="flex shrink-0 flex-wrap gap-2"><Button asChild><Link href="/import">Import spreadsheet</Link></Button><Button asChild variant="outline"><Link href="/demo-controls">Demo Controls</Link></Button></div>
    </CardContent></Card>}
    {IS_FLS ? <FlsKpis /> : IS_AMS ? <AmsKpis /> : <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Kpi label="Due within 30 days" value={due30} detail="active obligations" icon={CalendarClock} tone="navy" /><Kpi label="Due within 7 days" value={due7} detail="today included" icon={FileClock} tone="amber" /><Kpi label="Overdue" value={overdue} detail="needs action" icon={ShieldAlert} tone="red" /><Kpi label="Awaiting review" value={review} detail="submitted inspections" icon={ClipboardCheck} tone="green" /></div>}
    <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
      <Card><CardHeader className="flex-row items-center justify-between"><div><div className="eyebrow">Today’s work</div><CardTitle>What should move next?</CardTitle></div><Button asChild variant="ghost" size="sm"><Link href="/alerts">Open alert queue <ArrowUpRight data-icon="inline-end" /></Link></Button></CardHeader><CardContent>{todayActions.length ? <div className="stagger flex flex-col gap-2">{todayActions.map((item) => { const days = dateDiffDays(item.dueDate ?? state.demoDate, state.demoDate); return <Link href={`/register?asset=${item.assetId ?? ""}`} key={item.id} className="flex items-center justify-between gap-4 rounded-lg border border-line bg-paper px-3 py-3 transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-accent active:translate-y-0"><div className="flex min-w-0 items-center gap-3"><span className={`grid size-8 shrink-0 place-items-center rounded-md ${days < 0 ? "bg-[#fde8e8] text-danger" : "bg-[#fff2d7] text-[#8a5d00]"}`}><CircleAlert className="size-4" /></span><div className="min-w-0"><div className="truncate text-sm font-semibold text-navy">{item.assetRef} · {item.event}</div><div className="truncate text-xs text-slate-500">{item.owner} · {item.dueDate ? formatDate(item.dueDate) : `raised ${formatLocalDate(item.timestamp)}`}</div></div></div><div className="shrink-0 text-right"><Badge variant={days < 0 ? "danger" : "warning"}>{!item.dueDate ? "Follow up" : days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Today" : `${days}d`}</Badge></div></Link>; })}</div> : <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-slate-500">No active work falls within seven days.</div>}</CardContent></Card>
      <Card><CardHeader><div className="eyebrow">Recent activity</div><CardTitle>Recent activity</CardTitle></CardHeader><CardContent>{state.activity.length ? <div className="flex flex-col gap-4">{state.activity.slice(0, 6).map((item) => <div key={item.id} className="flex gap-3"><span className="mt-1 size-2 shrink-0 rounded-full bg-accent" /><div className="min-w-0"><div className="text-sm font-semibold text-navy">{item.event}</div><div className="truncate text-xs text-slate-500">{item.detail}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">{formatDateTime(item.timestamp)} · {item.actor}</div></div></div>)}</div> : <p className="text-sm text-slate-500">Import the fictional sample to start a local activity trail.</p>}</CardContent></Card>
    </div>
    {IS_FLS && state.records.length > 0 && <DigestCard />}
    <div className="rounded-xl border border-[#b8cedc] bg-[#eef7fb] p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="eyebrow text-accent">Demo signal</div><p className="mt-1 text-sm leading-relaxed text-navy">The visible date is <strong>{formatDate(state.demoDate)}</strong>. Move it in Demo Controls to exercise date tiers; the operating system clock never changes.</p></div><Button asChild variant="outline" size="sm"><Link href="/demo-controls">Open controls <ArrowUpRight data-icon="inline-end" /></Link></Button></div></div>
  </div>;
}
