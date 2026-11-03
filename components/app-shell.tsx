"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, AlertTriangle, BarChart3, Map as MapIcon, BellRing, BookOpenCheck, CalendarCheck, ChevronRight, ClipboardList, FileBadge, FileCheck2, Import, Leaf, Menu, TriangleAlert, Waves, Settings2, ShieldCheck, X } from "lucide-react";
import { AppProvider, useApp } from "@/components/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ImportView } from "@/components/views/import-view";
import { DashboardView } from "@/components/views/dashboard-view";
import { RegisterView } from "@/components/views/register-view";
import { InspectionsView } from "@/components/views/inspections-view";
import { ApprovalsView } from "@/components/views/approvals-view";
import { CertificatesView } from "@/components/views/certificates-view";
import { WarrantiesView } from "@/components/views/warranties-view";
import { SustainabilityView } from "@/components/views/sustainability-view";
import { AlertsView } from "@/components/views/alerts-view";
import { DemoControlsView } from "@/components/views/demo-controls-view";
import { FleetMapView } from "@/components/views/fleet-map-view";
import { SurveysView } from "@/components/views/surveys-view";
import { AnomaliesView } from "@/components/views/anomalies-view";
import { SafeenMark } from "@/components/safeen-mark";
import { BRAND, HIDDEN_VIEWS, IS_SAFEEN } from "@/lib/client";
import type { Role } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const nav = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "register", label: "Register", icon: ClipboardList },
  { id: "spreads", label: "Spreads", icon: MapIcon },
  { id: "surveys", label: "Surveys", icon: Waves },
  { id: "anomalies", label: "Anomalies", icon: TriangleAlert },
  { id: "inspections", label: "Inspections", icon: CalendarCheck },
  { id: "approvals", label: "Approvals", icon: BookOpenCheck },
  { id: "certificates", label: "Certificates", icon: ShieldCheck },
  { id: "warranties", label: "Warranties", icon: FileBadge },
  { id: "sustainability", label: "Sustainability", icon: Leaf },
  { id: "alerts", label: "Alerts", icon: BellRing },
  { id: "import", label: "Import", icon: Import },
  { id: "demo-controls", label: "Demo Controls", icon: Settings2 },
] as const;

const shownNav = nav.filter(({ id }) => !HIDDEN_VIEWS.includes(id)).map((item) => IS_SAFEEN && item.id === "register" ? { ...item, label: "Equipment" } : item);

// Kee keeps its navy sidebar; SAFEEN's sits on the page ground with a grey pill for the active screen.
const SIDE = IS_SAFEEN ? {
  aside: "border-line bg-[#f4f7f8] text-navy", mark: "bg-navy text-white", tagline: "text-slate-500", close: "text-navy hover:bg-black/5",
  env: "border-line bg-white", envLabel: "text-slate-500", envText: "text-slate-600", group: "text-slate-500 normal-case tracking-normal text-xs font-semibold",
  active: "bg-[#e3e9ec] text-navy", idle: "text-slate-600 hover:bg-black/5 hover:text-navy", count: "bg-danger text-white", countActive: "bg-danger text-white", rule: "bg-line", foot: "border-line text-slate-500",
} : {
  aside: "border-[#17496d] bg-[#0b3151] text-white", mark: "bg-white text-[#0b3151] shadow-lg", tagline: "text-[#a8c7dd]", close: "text-white hover:bg-white/10",
  env: "border-[#467493] bg-[#123e60]", envLabel: "text-[#bad2e1]", envText: "text-[#d6e7f1]", group: "text-[#80a9c2] uppercase tracking-[.16em] text-[10px] font-bold",
  active: "bg-white text-[#0b3151]", idle: "text-[#d1e3ed] hover:bg-white/10 hover:text-white", count: "bg-[#d74349] text-white", countActive: "bg-[#fde8e8] text-[#a52e35]", rule: "bg-[#2a5774]", foot: "border-[#2a5774] text-[#9cbed2]",
};

const titles: Record<string, { eyebrow: string; title: string; description: string }> = {
  import: { eyebrow: "Data intake", title: "Import", description: IS_SAFEEN ? "Validate an equipment register spreadsheet and review the rows before importing." : "Validate a register or sustainability savings spreadsheet and review the rows before importing." },
  dashboard: { eyebrow: "Operations overview", title: "Dashboard", description: "Deadlines, review work and recent movement for this demo date." },
  register: IS_SAFEEN ? { eyebrow: "Equipment register", title: "Equipment", description: "ROVs, tooling, lifting gear, survey sensors and crew competences, with the certificate or calibration each one needs." } : { eyebrow: "Asset register", title: "Asset register", description: "Search equipment, licences and their linked obligations." },
  anomalies: { eyebrow: "Asset integrity", title: "Anomalies", description: "Every finding on the client's lines, tracked from the survey that found it until it is repaired, re-inspected and closed." },
  surveys: { eyebrow: "ROV inspection", title: "Surveys", description: "Tally CP, wall thickness and anode readings point by point along a line or riser, then issue the survey report." },
  spreads: { eyebrow: "Positioning", title: "Spreads", description: "Where each vessel and the base are working, and what on board is out of date." },
  inspections: IS_SAFEEN ? { eyebrow: "Field work", title: "Inspections", description: "Run the pre-dive, calibration or lifting checklist for the equipment type, on deck or on a phone, then send it for review." } : { eyebrow: "Field work", title: "Inspections", description: "Draft a mobile-friendly checklist, then send it for review." },
  approvals: IS_SAFEEN ? { eyebrow: "Quality gate", title: "Approvals", description: "Issue the certificate, return the work for a correction, or take failed equipment out of service." } : { eyebrow: "Quality gate", title: "Approvals", description: "Return work with a correction, or issue a certificate with an explicit expiry." },
  certificates: { eyebrow: "Attestation", title: "Certificates", description: "Print a branded demo certificate and share a time-bound public snapshot." },
  warranties: { eyebrow: "Product warranty", title: "Warranties", description: "Type in a warranty from its original document to reissue it in the Kee format and track when it ends." },
  sustainability: { eyebrow: "Use less · Move less · Waste less", title: "Sustainability", description: "Record an environmental saving, print its certificate and see the quarter's total CO₂e." },
  alerts: { eyebrow: "Attention queue", title: "Alerts", description: "Acknowledge an alert without losing the underlying obligation." },
  "demo-controls": { eyebrow: "Scenario lab", title: "Demo Controls", description: IS_SAFEEN ? "Load the SAFEEN demo, download templates, change the demo date and exercise the main workflows." : "Download templates and sample data, change the demo date and exercise the main workflows." },
};

function View({ view }: { view: string }): ReactNode {
  if (HIDDEN_VIEWS.includes(view)) return <DashboardView />;
  switch (view) {
    case "spreads": return <FleetMapView />;
    case "surveys": return <SurveysView />;
    case "anomalies": return <AnomaliesView />;
    case "dashboard": return <DashboardView />;
    case "register": return <RegisterView />;
    case "inspections": return <InspectionsView />;
    case "approvals": return <ApprovalsView />;
    case "certificates": return <CertificatesView />;
    case "warranties": return <WarrantiesView />;
    case "sustainability": return <SustainabilityView />;
    case "alerts": return <AlertsView />;
    case "demo-controls": return <DemoControlsView />;
    case "import": return <ImportView />;
    default: return <DashboardView />;
  }
}

function AppFrame({ initialView }: { initialView: string }) {
  const pathname = usePathname();
  const view = pathname?.split("/")[1] || initialView || "dashboard";
  const { state, setRole, saveError, storageWarning, hydrated } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const firstNavLink = useRef<HTMLAnchorElement>(null);
  useEffect(() => { const media = window.matchMedia("(max-width: 1023px)"); const updateMobile = () => setIsMobile(media.matches); updateMobile(); media.addEventListener("change", updateMobile); return () => media.removeEventListener("change", updateMobile); }, []);
  useEffect(() => {
    if (!mobileOpen || !isMobile) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
      if (event.key === "Tab") {
        const items = sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
        const first = items?.[0]; const last = items?.[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey); firstNavLink.current?.focus();
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previousOverflow; menuButton.current?.focus(); };
  }, [mobileOpen, isMobile]);
  const meta = (!HIDDEN_VIEWS.includes(view) && titles[view]) || titles.dashboard;
  const openAlerts = state.alerts.filter((alert) => alert.status === "open").length;

  return <div className="app-grid min-h-screen lg:flex">
    <aside ref={sidebar} aria-hidden={isMobile && !mobileOpen} inert={isMobile && !mobileOpen ? true : undefined} className={`fixed inset-y-0 left-0 z-40 flex w-[268px] flex-col border-r ${SIDE.aside} px-4 py-5 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:overflow-y-auto ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex items-center justify-between px-2">
        <Link href="/dashboard" onClick={() => setMobileOpen(false)} className="flex items-center gap-3 focus-ring rounded-md">
          <span className={`grid size-10 place-items-center rounded-xl ${SIDE.mark}`}>{IS_SAFEEN ? <SafeenMark /> : <span className="text-xl font-black">{BRAND.mark}</span>}</span>
          <span><span className="block text-[19px] font-bold tracking-[-.03em]">KTrack</span><span className={`block text-[10px] font-bold uppercase tracking-[.15em] ${SIDE.tagline}`}>{BRAND.tagline}</span></span>
        </Link>
        <Button variant="ghost" size="icon" className={`${SIDE.close} lg:hidden`} aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X /></Button>
      </div>
      <div className={`mx-2 mt-8 rounded-lg border px-3 py-3 ${SIDE.env}`}><div className="flex items-center justify-between"><span className={`eyebrow ${SIDE.envLabel}`}>Environment</span><Badge variant="warning" className="px-2 py-0.5 text-[9px]">Demo mode</Badge></div><p className={`mt-2 text-xs leading-relaxed ${SIDE.envText}`}>Local-first workspace. Records stay in this browser.</p></div>
      <nav className="mt-7 flex flex-1 flex-col gap-1" aria-label="Primary navigation">
        <span className={`px-3 pb-2 ${SIDE.group}`}>Workspace</span>
        {shownNav.filter(({ id }) => id !== "demo-controls").map(({ id, label, icon: Icon }, index) => <Link ref={index === 0 ? firstNavLink : undefined} key={id} href={`/${id}`} onClick={() => setMobileOpen(false)} tabIndex={isMobile && !mobileOpen ? -1 : 0} className={`focus-ring group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${view === id ? SIDE.active : SIDE.idle}`}><Icon className="size-[17px]" aria-hidden="true" /><span>{label}</span>{id === "alerts" && openAlerts > 0 ? <span className={`ml-auto grid min-w-5 place-items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold ${view === id ? SIDE.countActive : SIDE.count}`}>{openAlerts}</span> : <ChevronRight className={`ml-auto size-3 opacity-0 transition-opacity group-hover:opacity-60 ${view === id ? "hidden" : ""}`} />}</Link>)}
        <Separator className={`my-5 ${SIDE.rule}`} />
        <span className={`px-3 pb-2 ${SIDE.group}`}>Sandbox</span>
        <Link href="/demo-controls" onClick={() => setMobileOpen(false)} tabIndex={isMobile && !mobileOpen ? -1 : 0} className={`focus-ring flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold ${view === "demo-controls" ? SIDE.active : SIDE.idle}`}><Settings2 className="size-[17px]" /><span>Demo Controls</span></Link>
      </nav>
      <div className={`border-t px-2 pt-4 text-[11px] leading-relaxed ${SIDE.foot}`}><div className="flex items-center gap-2"><Activity className="size-3" />Manual notifications only</div><div className="mt-1">v1.0 · fictional demo data</div></div>
    </aside>
    {mobileOpen && <button className="fixed inset-0 z-30 bg-[#071d30]/50 lg:hidden" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <main inert={isMobile && mobileOpen ? true : undefined} className="min-w-0 flex-1">
      <header className="sticky top-0 z-20 border-b border-line bg-paper print-hidden"><div className="flex min-h-[76px] flex-col justify-center gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-8 lg:px-10"><div className="flex min-w-0 items-center gap-3"><Button variant="ghost" size="icon" className="-ml-2 lg:hidden" ref={menuButton} aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu /></Button><div className="min-w-0"><div className="eyebrow">{meta.eyebrow}</div><h1 className="truncate text-xl font-bold tracking-[-.03em] text-navy sm:text-2xl">{meta.title}</h1></div></div><div className="flex items-center justify-end gap-2 sm:gap-3"><div className="text-right"><div className="eyebrow">Demo date</div><div className="text-xs font-bold text-navy sm:text-sm">{formatDate(state.demoDate)}</div></div><label className="sr-only" htmlFor="role-switcher">Current role</label><Select id="role-switcher" value={state.role} onChange={(event) => setRole(event.target.value as Role)} className="w-[125px] bg-white text-xs font-semibold sm:w-[145px]"><option>Admin</option><option>Engineer</option><option>Reviewer</option><option>Manager</option></Select></div></div></header>
      <div className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9"><div className="mb-7 max-w-3xl text-sm leading-relaxed text-slate-600">{meta.description}</div>{(saveError || storageWarning) && <div role="alert" className="mb-5 rounded-lg border border-[#f0c2c3] bg-[#fff3f3] p-4 text-sm text-danger">{saveError || storageWarning}{storageWarning && <Link className="ml-2 underline" href="/demo-controls">Open recovery controls</Link>}</div>}{hydrated ? <View view={view} /> : <p role="status">Restoring this browser workspace…</p>}</div>
    </main>
  </div>;
}

export function AppShell({ initialView }: { initialView: string }) { return <AppProvider><AppFrame initialView={initialView} /></AppProvider>; }
