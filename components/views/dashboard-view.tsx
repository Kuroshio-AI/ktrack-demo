"use client";

import Link from "next/link";
import { ArrowUpRight, CalendarClock, CircleAlert, ClipboardCheck, FileClock, ShieldAlert } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IS_SAFEEN } from "@/lib/client";
import { dateDiffDays, deadlineLabel } from "@/lib/domain";
import { spreadReadiness } from "@/lib/spreads";
import { formatDate, formatDateTime } from "@/lib/utils";

function Kpi({ label, value, detail, icon: Icon, tone = "navy" }: { label: string; value: number; detail: string; icon: typeof CalendarClock; tone?: "navy" | "amber" | "red" | "green" }) {
  return <Card className="relative overflow-hidden"><div className={`absolute inset-x-0 top-0 h-1 ${tone === "amber" ? "bg-[#d99512]" : tone === "red" ? "bg-danger" : tone === "green" ? "bg-[#269663]" : "bg-accent"}`} /><CardContent className="p-5"><div className="eyebrow">{label}</div><div className="mt-2 flex items-center justify-between gap-3"><div className="text-3xl font-bold tracking-[-.06em] text-navy">{value}</div><span className={`grid size-10 shrink-0 place-items-center rounded-lg ${tone === "amber" ? "bg-[#fff2d7] text-[#8a5d00]" : tone === "red" ? "bg-[#fde8e8] text-danger" : tone === "green" ? "bg-[#e7f4ed] text-[#187348]" : "bg-[#e8f3f8] text-accent"}`}><Icon className="size-5" /></span></div><div className="mt-1 text-xs text-slate-500">{detail}</div></CardContent></Card>;
}

export function DashboardView() {
  const { state } = useApp();
  const open = state.alerts.filter((alert) => alert.status === "open");
  const overdue = open.filter((alert) => alert.tier === "overdue").length;
  const due7 = open.filter((alert) => alert.tier === "due7" || alert.tier === "today").length;
  const due30 = open.filter((alert) => ["due30", "due7", "today"].includes(alert.tier ?? "")).length;
  const review = state.inspections.filter((inspection) => inspection.status === "Submitted").length;
  const todayActions = open.filter((alert) => ["due7", "today", "overdue"].includes(alert.tier ?? "")).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")).slice(0, 6);
  return <div className="flex flex-col gap-6">
    {state.records.length === 0 && <Card><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="font-semibold text-navy">{IS_SAFEEN ? "No equipment registered yet." : "Your register is ready to set up."}</h2><p className="mt-1 text-sm text-slate-500">{IS_SAFEEN ? "Load the SAFEEN demo from Demo Controls, or import your equipment register." : "Import a spreadsheet to see deadlines and alerts. Templates and sample data are in Demo Controls."}</p></div>
      <div className="flex shrink-0 flex-wrap gap-2"><Button asChild><Link href="/import">Import spreadsheet</Link></Button><Button asChild variant="outline"><Link href="/demo-controls">Demo Controls</Link></Button></div>
    </CardContent></Card>}
    {IS_SAFEEN && state.records.length > 0 && <SpreadReadiness />}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Kpi label="Due within 30 days" value={due30} detail="active obligations" icon={CalendarClock} tone="navy" /><Kpi label="Due within 7 days" value={due7} detail="today included" icon={FileClock} tone="amber" /><Kpi label="Overdue" value={overdue} detail="needs action" icon={ShieldAlert} tone="red" /><Kpi label="Awaiting review" value={review} detail="submitted inspections" icon={ClipboardCheck} tone="green" /></div>
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]">
      <Card><CardHeader className="flex-row flex-wrap items-center justify-between gap-2"><div><div className="eyebrow">Today’s work</div><CardTitle>What should move next?</CardTitle></div><Button asChild variant="ghost" size="sm"><Link href="/alerts">Open alert queue <ArrowUpRight data-icon="inline-end" /></Link></Button></CardHeader><CardContent>{todayActions.length ? <div className="flex flex-col gap-2">{todayActions.map((item) => { const days = dateDiffDays(item.dueDate ?? state.demoDate, state.demoDate); return <Link href={`/register?asset=${item.assetId ?? ""}`} key={item.id} className="flex items-center justify-between gap-4 rounded-lg border border-line bg-paper px-3 py-3 transition-colors hover:border-accent"><div className="flex min-w-0 items-center gap-3"><span className={`grid size-8 shrink-0 place-items-center rounded-md ${days < 0 ? "bg-[#fde8e8] text-danger" : "bg-[#fff2d7] text-[#8a5d00]"}`}><CircleAlert className="size-4" /></span><div className="min-w-0"><div className="truncate text-sm font-semibold text-navy">{item.assetRef} · {item.event}</div><div className="truncate text-xs text-slate-500">{item.owner} · {item.dueDate ? formatDate(item.dueDate) : "No date"}</div></div></div><div className="shrink-0 text-right"><Badge variant={days < 0 ? "danger" : "warning"}>{days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Today" : `${days}d`}</Badge></div></Link>; })}</div> : <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-slate-500">No active work falls within seven days.</div>}</CardContent></Card>
      <Card><CardHeader><div className="eyebrow">Recent activity</div><CardTitle>Recent activity</CardTitle></CardHeader><CardContent>{state.activity.length ? <div className="flex flex-col gap-4">{state.activity.slice(0, 6).map((item) => <div key={item.id} className="flex gap-3"><span className="mt-1 size-2 shrink-0 rounded-full bg-accent" /><div className="min-w-0"><div className="text-sm font-semibold text-navy">{item.event}</div><div className="truncate text-xs text-slate-500">{item.detail}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">{formatDateTime(item.timestamp)} · {item.actor}</div></div></div>)}</div> : <p className="text-sm text-slate-500">Import the fictional sample to start a local activity trail.</p>}</CardContent></Card>
    </div>
    <div className="rounded-xl border border-[#b8cedc] bg-[#eef7fb] p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="eyebrow text-accent">Demo signal</div><p className="mt-1 text-sm leading-relaxed text-navy">The visible date is <strong>{formatDate(state.demoDate)}</strong>. Move it in Demo Controls to exercise date tiers; the operating system clock never changes.</p></div><Button asChild variant="outline" size="sm"><Link href="/demo-controls">Open controls <ArrowUpRight data-icon="inline-end" /></Link></Button></div></div>
  </div>;
}

// SAFEEN's first question: is each spread fit to work today, and if not, what is stopping it.
function SpreadReadiness() {
  const { state } = useApp();
  const spreads = spreadReadiness(state.records, state.demoDate);
  // One line per spread: where it is, whether it can work, and what's stopping it, most urgent first.
  return <Card><CardHeader className="flex-row items-center justify-between py-3"><CardTitle className="text-base">Spread readiness</CardTitle><Button asChild variant="ghost" size="sm"><Link href="/spreads">Open map <ArrowUpRight data-icon="inline-end" /></Link></Button></CardHeader>
    <CardContent className="p-0"><ul className="divide-y divide-line border-t border-line">{spreads.map(({ site, records, blocking, dueThisWeek }) => {
      const issues = blocking.length ? blocking : dueThisWeek;
      const tone = blocking.length ? "text-danger" : dueThisWeek.length ? "text-[#8a5d00]" : "text-success";
      const dot = blocking.length ? "bg-danger" : dueThisWeek.length ? "bg-[#d99512]" : "bg-success";
      return <li key={site.name} className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-1 px-5 py-2.5 text-sm sm:grid-cols-[minmax(0,200px)_minmax(0,230px)_minmax(0,1fr)] sm:items-baseline">
        <div className="min-w-0 truncate"><span className="font-semibold text-navy">{site.name}</span> <span className="text-xs text-slate-500">{site.kind} · {records.length}</span></div>
        <div className={`flex items-center gap-2 font-semibold ${tone}`}><span className={`size-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />{blocking.length ? `Not fit to work · ${blocking.length} blocking` : dueThisWeek.length ? `Fit to work · ${dueThisWeek.length} due this week` : "Fit to work"}</div>
        <div className="min-w-0 truncate text-slate-600">{issues.length ? issues.slice(0, 2).map(({ record, deadline }, index) => <span key={record.id}>{index > 0 && <span className="text-slate-300"> · </span>}<Link href={`/register?asset=${record.id}`} className="hover:underline"><span className="font-semibold text-navy">{record.assetRef}</span> {deadlineLabel(deadline).toLowerCase()}</Link></span>) : <span className="text-slate-400">Nothing due this week</span>}{issues.length > 2 && <Link href="/spreads" className="text-slate-500 hover:underline"><span className="text-slate-300"> · </span>+{issues.length - 2} more</Link>}</div>
      </li>;
    })}</ul></CardContent>
  </Card>;
}
