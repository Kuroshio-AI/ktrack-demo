"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Map as LeafletMap, Marker } from "leaflet";
import { Anchor, ChevronDown, Navigation, Ship, Warehouse } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deadlineLabel, deadlineTier, deadlineWhen, nextDeadline, OUT_OF_SERVICE } from "@/lib/domain";
import { formatFix, SPREAD_SITES, type SpreadSite } from "@/lib/safeen";
import { spreadReadiness, unplacedRecords } from "@/lib/spreads";
import type { AssetRecord } from "@/lib/types";

type Worst = "overdue" | "soon" | "ok";
const PIN = { overdue: "#c2373d", soon: "#d99512", ok: "#0b3151" };
const ICON = { Vessel: Ship, "Unmanned vessel": Navigation, "Harbour tug": Anchor, Base: Warehouse };

// Where each spread is working and what on board needs attention; positions are fictional fixes from the demo.
export function FleetMapView() {
  const { state } = useApp();
  const mapDiv = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap>(undefined);
  const markers = useRef<Record<string, Marker>>({});
  const [selected, setSelected] = useState(SPREAD_SITES[0].name);
  const [leaflet, setLeaflet] = useState<typeof import("leaflet")>();
  const [showAll, setShowAll] = useState(false);

  const bySite = useMemo(() => Object.fromEntries(spreadReadiness(state.records, state.demoDate).map((spread) => {
    const worst: Worst = spread.blocking.length ? "overdue" : spread.dueThisWeek.length ? "soon" : "ok";
    return [spread.site.name, { ...spread, worst }];
  })), [state.records, state.demoDate]);
  const unplaced = unplacedRecords(state.records);

  // Leaflet touches window on import, so it loads in the browser only.
  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !mapDiv.current || map.current) return;
      const created = L.map(mapDiv.current, { scrollWheelZoom: false, maxZoom: 13 }).fitBounds(SPREAD_SITES.map((site) => [site.lat, site.lon]), { paddingTopLeft: [40, 40], paddingBottomRight: [150, 40] });
      // Esri's ocean basemap shows the bathymetry; OpenSeaMap adds buoys and lights on top. Both are free with attribution.
      const esri = "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean";
      L.tileLayer(`${esri}/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}`, { attribution: "Tiles &copy; Esri, GEBCO, NOAA, Garmin", maxZoom: 13 }).addTo(created);
      L.tileLayer(`${esri}/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 13 }).addTo(created);
      L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", { attribution: "Seamarks &copy; OpenSeaMap", maxZoom: 13 }).addTo(created);
      map.current = created;
      for (const site of SPREAD_SITES) markers.current[site.name] = L.marker([site.lat, site.lon], { title: site.name, keyboard: true }).bindTooltip(site.name, { permanent: true, direction: "right", offset: [10, 0] }).on("click", () => setSelected(site.name)).addTo(created);
      setLeaflet(L);
    });
    return () => { cancelled = true; map.current?.remove(); map.current = undefined; markers.current = {}; };
  }, []);

  // Pins are re-coloured when deadlines move; the selected one is drawn larger.
  useEffect(() => {
    if (!leaflet) return;
    for (const site of SPREAD_SITES) {
      const size = site.name === selected ? 22 : 16;
      markers.current[site.name]?.setIcon(leaflet.divIcon({ className: "", iconSize: [size, size], html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:9999px;background:${PIN[bySite[site.name].worst]};border:3px solid white;box-shadow:0 1px 6px rgba(0,0,0,.35)"></span>` }));
    }
  }, [leaflet, bySite, selected]);

  function focus(site: SpreadSite) { setSelected(site.name); map.current?.flyTo([site.lat, site.lon], 9, { duration: 0.8 }); }
  const current = SPREAD_SITES.find((site) => site.name === selected) ?? SPREAD_SITES[0];
  const detail = bySite[current.name];
  // Out of service, overdue or due within 30 days comes first; everything else waits behind a toggle.
  const needsAttention = (record: AssetRecord) => { const deadline = nextDeadline(record, state.demoDate); return Boolean(deadline && (deadline.event === OUT_OF_SERVICE || deadline.days <= 30)); };
  const attention = detail.records.filter(needsAttention);
  const inDate = detail.records.filter((record) => !needsAttention(record));
  // The one thing to act on first: equipment out of service, then the most overdue item, on any spread.
  const urgency = (event: string, days: number) => event === OUT_OF_SERVICE ? -Infinity : days;
  const worst = SPREAD_SITES.flatMap((site) => [...bySite[site.name].blocking, ...bySite[site.name].dueThisWeek].map((due) => ({ site, ...due })))
    .sort((a, b) => urgency(a.deadline.event, a.deadline.days) - urgency(b.deadline.event, b.deadline.days))[0];

  return <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,.65fr)]">
    {worst && <div className="flex flex-col gap-3 rounded-xl border border-line bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between xl:col-span-2">
      <p className="text-sm text-navy"><strong className={worst.deadline.days < 0 || worst.deadline.event === OUT_OF_SERVICE ? "text-danger" : "text-[#8a5d00]"}>{worst.record.assetRef}</strong> on {worst.site.name}: {deadlineLabel(worst.deadline).toLowerCase()} · {worst.record.assetType}</p>
      <Button asChild size="sm" variant="outline" className="shrink-0"><Link href={`/register?asset=${worst.record.id}`}>Open {worst.record.assetRef}</Link></Button>
    </div>}
    <Card className="overflow-hidden"><div ref={mapDiv} className="relative z-0 h-[380px] w-full bg-[#b5d0e6] sm:h-[456px]" role="application" aria-label="Map of spread positions" /></Card>
    <div className="flex flex-col gap-3">
      {SPREAD_SITES.map((site) => { const info = bySite[site.name]; const Icon = ICON[site.kind]; return <button key={site.name} type="button" onClick={() => focus(site)} aria-pressed={site.name === selected} className={`focus-ring flex items-start gap-3 rounded-xl border bg-white px-4 py-3 text-left transition-[border-color,transform] duration-150 ease-out active:scale-[0.99] ${site.name === selected ? "border-accent bg-[#f3f9fc] ring-1 ring-accent" : "border-line hover:border-accent/50"}`}>
        <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden="true" />
        <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate font-semibold text-navy">{site.name}</span>{info.blocking.length ? <Badge variant="danger">{info.blocking.length} blocking</Badge> : info.dueThisWeek.length ? <Badge variant="warning">{info.dueThisWeek.length} due this week</Badge> : <Badge variant="success">Fit to work</Badge>}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{site.activity}</span><span className="mt-1 block text-xs tabular-nums text-slate-500">{formatFix(site.lat, site.lon)}</span></span>
      </button>; })}
    </div>
    <Card className="xl:col-span-2"><CardHeader className="flex-row items-center justify-between gap-3"><div><div className="eyebrow">{current.kind} · {formatFix(current.lat, current.lon)}</div><CardTitle>Equipment on {current.name}</CardTitle></div><span className="shrink-0 text-sm text-slate-500">{attention.length ? <><span className="font-semibold text-navy">{attention.length}</span> of {detail.records.length} need attention</> : `${detail.records.length} active, all in date`}</span></CardHeader><CardContent>
      {detail.records.length ? <>
        {attention.length > 0 && <ul className="grid grid-cols-[minmax(0,1fr)] gap-x-8 lg:grid-cols-2">{attention.map((record) => <EquipmentRow key={record.id} record={record} demoDate={state.demoDate} />)}</ul>}
        {inDate.length > 0 && <div className={attention.length ? "mt-4" : ""}>
          <button type="button" aria-expanded={showAll} onClick={() => setShowAll((open) => !open)} className="focus-ring flex items-center gap-1.5 rounded-md text-sm font-semibold text-accent transition-transform active:scale-[0.97]"><ChevronDown className={`size-4 transition-transform duration-200 ease-out ${showAll ? "rotate-180" : ""}`} aria-hidden="true" />{showAll ? "Hide" : "Show"} the {inDate.length} in date</button>
          {showAll && <ul className="animate-rise mt-2 grid grid-cols-[minmax(0,1fr)] gap-x-8 lg:grid-cols-2">{inDate.map((record) => <EquipmentRow key={record.id} record={record} demoDate={state.demoDate} quiet />)}</ul>}
        </div>}
      </> : <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-slate-500">No active equipment is registered to {current.name}.</p>}
      {unplaced.length > 0 && <p className="mt-4 text-xs text-slate-500">Not on the map: {unplaced.map((record) => `${record.assetRef} (${record.site})`).join(", ")}. Set their site to {SPREAD_SITES.map((site) => site.name).join(", ")} to place them.</p>}
    </CardContent></Card>
  </div>;
}

// One line per item, room for the full name: reference, what it is, what it owes and when.
function EquipmentRow({ record, demoDate, quiet }: { record: AssetRecord; demoDate: string; quiet?: boolean }) {
  const deadline = nextDeadline(record, demoDate);
  const tier = deadline && (deadline.event === OUT_OF_SERVICE ? "overdue" : deadlineTier(deadline.days));
  const tone = quiet ? "text-slate-500" : tier === "overdue" ? "text-danger" : tier && tier !== "due30" ? "text-[#8a5d00]" : "text-navy";
  return <li className="border-b border-line/70"><Link href={`/register?asset=${record.id}`} className="-mx-2 flex items-baseline gap-3 rounded-md px-2 py-2 transition-colors hover:bg-paper">
    <span className="w-[72px] shrink-0 font-mono text-xs font-semibold text-navy">{record.assetRef}</span>
    <span className="min-w-0 flex-1 truncate text-sm text-slate-600" title={record.assetType}>{record.assetType}</span>
    {deadline && <span className="shrink-0 text-right text-xs"><span className={`font-semibold tabular-nums ${tone}`}>{deadlineWhen(deadline.days, deadline.event)}</span> <span className="text-slate-400">{deadline.event === OUT_OF_SERVICE ? "out of service" : deadline.event.replace(/ (due|expiry)$/, "").split(" ").map((word) => word === word.toUpperCase() ? word : word.toLowerCase()).join(" ")}</span></span>}
  </Link></li>;
}
