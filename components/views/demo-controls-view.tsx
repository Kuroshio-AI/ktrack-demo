"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, Download, Import as ImportIcon, RotateCcw, ShieldAlert, Sparkles, Trash2, Upload } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { useConnectionsImport } from "@/components/connections-import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { sampleRows, sampleSavings } from "@/lib/sample";
import { downloadRegister } from "@/lib/register-download";
import { Select } from "@/components/ui/select";
import { IS_AMS, IS_FLS } from "@/lib/client";
import { downloadTemplate } from "@/lib/ams";
import { addMonthsClamped, approveInspection, createInspection, recalculateAlerts, setDeadlineShortcut, submitInspection, todayString, updateInspection, validateStoredState } from "@/lib/domain";

export function DemoControlsView() {
  const { state, setDemoDate, update, clearOperationalData, restore, storageWarning } = useApp();
  const [backupMessage, setBackupMessage] = useState("");
  const backupInput = useRef<HTMLInputElement>(null);
  const [assetId, setAssetId] = useState(state.records[0]?.id ?? "");
  const [certificateExpiry, setCertificateExpiry] = useState(addMonthsClamped(state.demoDate, 12));
  const [message, setMessage] = useState("");
  const [whatsapp, setWhatsapp] = useState<{ configured: boolean; recipientLabel?: string; templateName?: string; templateLanguage?: string; webhookConfigured?: boolean; tokenUpdatable?: boolean; tokenSource?: string; message: string }>({ configured: false, message: "Checking configuration…" });
  const [whatsappVersion, setWhatsappVersion] = useState(0);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenMessage, setTokenMessage] = useState("");
  const selected = state.records.find((record) => record.id === assetId);
  const submitted = state.inspections.find((inspection) => inspection.status === "Submitted");
  const importer = useConnectionsImport();
  const connections = state.connections ?? [];

  useEffect(() => {
    const controller = new AbortController();
    let ignore = false;
    fetch("/api/alerts/whatsapp", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok || !body || typeof body !== "object") throw new Error("Configuration unavailable");
        const candidate = body as Record<string, unknown>;
        if (!ignore) setWhatsapp({
          configured: candidate.configured === true,
          recipientLabel: typeof candidate.recipientLabel === "string" ? candidate.recipientLabel : undefined,
          templateName: typeof candidate.templateName === "string" ? candidate.templateName : undefined,
          templateLanguage: typeof candidate.templateLanguage === "string" ? candidate.templateLanguage : undefined,
          webhookConfigured: candidate.webhookConfigured === true,
          tokenUpdatable: candidate.tokenUpdatable === true,
          tokenSource: typeof candidate.tokenSource === "string" ? candidate.tokenSource : undefined,
          message: candidate.configured === true ? "Configured" : "Not configured — add the Meta WhatsApp Cloud API settings to the server environment.",
        });
      })
      .catch(() => { if (!ignore) setWhatsapp({ configured: false, message: "Configuration unavailable. Refresh to check again." }); });
    return () => { ignore = true; controller.abort(); };
  }, [whatsappVersion]);

  async function saveToken() {
    setTokenSaving(true);
    setTokenMessage("");
    try {
      const response = await fetch("/api/alerts/whatsapp/token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenInput.trim() }),
      });
      const body: unknown = await response.json().catch(() => undefined);
      const error = body && typeof body === "object" && typeof (body as Record<string, unknown>).error === "string" ? (body as Record<string, string>).error : undefined;
      if (!response.ok) { setTokenMessage(error ?? "The token could not be saved."); return; }
      setTokenInput("");
      setTokenMessage("Token saved. WhatsApp alerts use it from now on.");
      setWhatsappVersion((version) => version + 1);
    } catch {
      setTokenMessage("The token could not be saved. Check your connection and try again.");
    } finally {
      setTokenSaving(false);
    }
  }

  function shortcut(days: number) { if (!assetId) return; if (update((current) => setDeadlineShortcut(current, assetId, days))) setMessage(`${selected?.assetRef ?? "Record"} is now ${days < 0 ? `${Math.abs(days)} days overdue` : days === 0 ? "due today" : `due in ${days} days`}.`); }
  function simulateSubmitted() {
    if (!assetId) return;
    update((current) => {
      const result = createInspection(current, assetId);
      const passed = result.inspection.checklist.map((item) => ({ ...item, result: "pass" as const }));
      return submitInspection(updateInspection(result.state, result.inspection.id, { checklist: passed, notes: "Explicit demo checklist submission." }), result.inspection.id);
    });
    setMessage("A passed demo inspection is waiting in Approvals.");
  }
  function simulateApproval() {
    if (!submitted) { setMessage("Submit a demo inspection first."); return; }
    if (!certificateExpiry || certificateExpiry < state.demoDate) { setMessage("Choose an expiry on or after the demo date."); return; }
    if (update((current) => approveInspection(current, submitted.id, certificateExpiry))) setMessage("Demo certificate issued. Open Certificates to print or create its QR.");
  }
  // Everything lives in this browser, so a file is the only way to keep a trial's data through a reset or a new laptop.
  function downloadBackup() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ktrack-backup-${todayString()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setBackupMessage("Backup downloaded. Keep the file somewhere safe.");
  }
  async function restoreBackup(file?: File) {
    setBackupMessage("");
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setBackupMessage("That file is over 10MB, so it isn't a KTrack backup. Nothing was changed."); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(await file.text()); } catch { parsed = undefined; }
    if (!validateStoredState(parsed)) { setBackupMessage("That file isn't a KTrack backup, or it's damaged. Nothing was changed."); return; }
    if (!window.confirm(`Replace everything in this browser with the backup (${parsed.records.length} records)? Current data will be lost.`)) return;
    if (restore(recalculateAlerts(parsed))) setBackupMessage(`Backup restored: ${parsed.records.length} records.`);
  }
  function reset() {
    if (window.confirm(IS_AMS ? "Reset this demo? This browser goes back to the sample jobs and dimension table, and everything else here is cleared. Download a backup first if you need this data." : IS_FLS ? "Reset this demo? All buildings and alerts in this browser will be cleared. Download a backup first if you need this data." : "Reset this demo? All local operational records, inspections, alerts, certificates, warranties and sustainability savings will be cleared. Download a backup first if you need this data.")) { if (clearOperationalData()) window.location.assign("/dashboard"); }
  }
  return <div className="grid gap-5 lg:grid-cols-2">
    {!IS_FLS && !IS_AMS && <Card className="lg:col-span-2"><CardHeader><div className="eyebrow">Ready-made inputs</div><CardTitle>Use the register template.</CardTitle><CardDescription>Download a blank template or preview one of two fictional six-row scenarios through the same validation path.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3"><div className="grid gap-2 sm:grid-cols-2"><Button variant="outline" className="justify-start" aria-label="Download blank register template as XLSX" onClick={() => downloadRegister("xlsx", [], [], "ktrack-register-template")}><Download data-icon="inline-start" />Blank template <span className="ml-auto text-xs text-slate-400">.xlsx</span></Button><Button variant="outline" className="justify-start" aria-label="Download blank register template as CSV" onClick={() => downloadRegister("csv", [], [], "ktrack-register-template")}><Download data-icon="inline-start" />Blank template <span className="ml-auto text-xs text-slate-400">.csv</span></Button></div><Separator /><div className="grid gap-4 md:grid-cols-2"><div className="rounded-lg border border-line bg-paper p-4"><div className="eyebrow text-accent">Filled sample 1</div><div className="mt-1 font-semibold text-navy">Inspections &amp; approvals</div><p className="mt-2 text-xs leading-relaxed text-slate-500">Exercise due and overdue inspections, licence expiry, a valid certificate and a retired record.</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><Button variant="secondary" className="justify-start" aria-label="Download filled sample 1 as XLSX" onClick={() => downloadRegister("xlsx", sampleRows(state.demoDate, "1"), sampleSavings(state.demoDate, "1"), "ktrack-sample-1-register")}><Download data-icon="inline-start" />Download XLSX</Button><Button variant="secondary" className="justify-start" aria-label="Download filled sample 1 as CSV" onClick={() => downloadRegister("csv", sampleRows(state.demoDate, "1"), sampleSavings(state.demoDate, "1"), "ktrack-sample-1-register")}><Download data-icon="inline-start" />Download CSV</Button><Button asChild className="justify-start sm:col-span-2"><Link href="/import?sample=1"><ImportIcon data-icon="inline-start" />Preview filled sample 1</Link></Button></div></div><div className="rounded-lg border border-line bg-paper p-4"><div className="eyebrow text-accent">Filled sample 2</div><div className="mt-1 font-semibold text-navy">Renewals &amp; retirement</div><p className="mt-2 text-xs leading-relaxed text-slate-500">Exercise an expired certificate renewal, independent deadlines and retired-record exclusion.</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><Button variant="secondary" className="justify-start" aria-label="Download filled sample 2 as XLSX" onClick={() => downloadRegister("xlsx", sampleRows(state.demoDate, "2"), sampleSavings(state.demoDate, "2"), "ktrack-sample-2-register")}><Download data-icon="inline-start" />Download XLSX</Button><Button variant="secondary" className="justify-start" aria-label="Download filled sample 2 as CSV" onClick={() => downloadRegister("csv", sampleRows(state.demoDate, "2"), sampleSavings(state.demoDate, "2"), "ktrack-sample-2-register")}><Download data-icon="inline-start" />Download CSV</Button><Button asChild className="justify-start sm:col-span-2"><Link href="/import?sample=2"><ImportIcon data-icon="inline-start" />Preview filled sample 2</Link></Button></div></div></div></CardContent><CardFooter><p className="text-xs leading-relaxed text-slate-500">Both samples contain six records and three sustainability savings, and can be imported together. Dates use the visible demo date; inspections and approvals are created through the workflow.</p></CardFooter></Card>}
    {storageWarning && <Card className="border-[#e7be6a] bg-[#fffaf0] lg:col-span-2"><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><ShieldAlert className="mt-0.5 size-5 shrink-0 text-[#a36b00]" /><div><div className="font-semibold text-navy">Storage recovery is waiting for you.</div><p className="mt-1 text-sm text-slate-600">KTrack has not overwritten the unreadable stored bytes. Start fresh only after confirming that recovery is not needed.</p></div></div><Button variant="destructive" onClick={() => { if (window.confirm("Start a new empty demo and discard the unreadable local state?") && clearOperationalData()) window.location.assign("/dashboard"); }}>Start fresh</Button></CardContent></Card>}
    {/* A reset brings back the sample table, so the client's own table is imported again from here before a demo. */}
    {IS_AMS && <Card className="lg:col-span-2"><CardContent className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="eyebrow">Dimension table</div><div className="mt-1 font-semibold text-navy">Load the client&apos;s table from Excel.</div><p className="mt-1 text-sm text-slate-500">{connections.length} connection{connections.length === 1 ? "" : "s"} in this browser{connections.some((spec) => spec.sample) ? ", including the made-up samples" : ""}. Import a DS-1 or API RP 7G-2 workbook to grade tally sheets against it; a reset puts the samples back. <Link href="/connections" className="font-semibold text-accent underline-offset-2 hover:underline">Open Connections</Link></p></div>
        <div className="flex shrink-0 flex-wrap gap-2"><Button variant="outline" onClick={downloadTemplate}><Download data-icon="inline-start" />Template</Button><Button onClick={importer.open}><Upload data-icon="inline-start" />Import from Excel</Button>{importer.input}</div>
      </div>
      {importer.panel}
    </CardContent></Card>}
    <Card className="lg:col-span-2"><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div><div className="eyebrow">Keep this workspace</div><div className="mt-1 font-semibold text-navy">Back up before clearing the browser or switching computers.</div><p className="mt-1 text-sm text-slate-500">Everything stays in this browser only. {IS_AMS ? "A backup file holds every tally sheet, report, connection and alert." : IS_FLS ? "A backup file holds every building, alert and activity entry." : "A backup file holds every record, warranty, inspection, certificate and sustainability saving."}</p>{backupMessage && <p className="mt-2 text-sm text-navy" role="status">{backupMessage}</p>}</div>
      <div className="flex shrink-0 flex-wrap gap-2"><Button variant="outline" disabled={Boolean(storageWarning)} onClick={downloadBackup}><Download data-icon="inline-start" />Download backup</Button><Button variant="secondary" onClick={() => backupInput.current?.click()}><Upload data-icon="inline-start" />Restore backup</Button><input ref={backupInput} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => { void restoreBackup(event.target.files?.[0]); event.target.value = ""; }} /></div>
    </CardContent></Card>
    <Card id="whatsapp-trial" className="scroll-mt-24 lg:col-span-2">
      <CardHeader>
        <div className="eyebrow">Presentation setup</div>
        <CardTitle>WhatsApp Cloud API</CardTitle>
        <CardDescription>Send one selected alert&apos;s event, asset, site, severity and due date to the fixed server-configured recipient. The template and Meta credentials stay server-selected.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3">
          <div role="status"><Badge variant={whatsapp.configured ? "success" : "secondary"}>{whatsapp.message}</Badge>
            {whatsapp.recipientLabel && <p className="mt-2 text-sm text-slate-600">{whatsapp.recipientLabel}</p>}
          </div>
          <p className="text-sm leading-relaxed text-slate-500">Configure the Meta WhatsApp Cloud API credentials, fixed recipient and configured template in the server environment before presenting. Anyone using this demo can send an alert to the fixed recipient.</p>
          {whatsapp.configured && <p className="text-xs leading-relaxed text-slate-500">Webhook verification settings: {whatsapp.webhookConfigured ? "present" : "not set"}. Authenticated callbacks are acknowledged for this demo but are not stored.</p>}
          <Button asChild variant="outline" size="sm"><Link href="/alerts">Open Alerts</Link></Button>
          {whatsapp.tokenUpdatable && <form className="space-y-2 border-t border-line pt-3" onSubmit={(event) => { event.preventDefault(); void saveToken(); }}>
            <label className="eyebrow" htmlFor="meta-access-token">Meta access token</label>
            <p className="text-xs leading-relaxed text-slate-500">Paste a new token when the current one expires. Meta must confirm it works with the KTrack WhatsApp number before it is saved. {whatsapp.tokenSource === "website" ? "Currently using a token saved here." : "Currently using the server token."}</p>
            <div className="flex gap-2">
              <Input id="meta-access-token" type="password" autoComplete="off" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} placeholder="EAA…" />
              <Button type="submit" size="sm" disabled={!tokenInput.trim() || tokenSaving}>{tokenSaving ? "Checking…" : "Save token"}</Button>
            </div>
            {tokenMessage && <p className="text-sm text-navy" role="status">{tokenMessage}</p>}
          </form>}
        </div>
        <div>
          <div className="eyebrow">Server-selected template</div>
          <p className="mt-2 rounded-lg border border-line bg-paper p-3 text-sm leading-relaxed text-navy">{whatsapp.templateName && whatsapp.templateLanguage ? `${whatsapp.templateName} · ${whatsapp.templateLanguage}` : "Template details appear when the server configuration is available."}</p>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-paper p-3 text-xs leading-relaxed text-navy">{IS_FLS ? `KTrack FLS certificate alert.\nEvent: {{1}}\nBuilding: {{2}}\nCategory: {{3}}\nSeverity: {{4}}\nDue date: {{5}}\nPlease review this building in KTrack.` : `KTrack maintenance alert for your registered equipment.\nEvent: {{1}}\nAsset: {{2}}\nSite: {{3}}\nSeverity: {{4}}\nDue date: {{5}}\nPlease review this item in your KTrack register.`}</pre>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">Parameters are sent in order: event, asset reference, site, severity and due date. Meta determines the final template status and category. Acceptance means the request was accepted, not that delivery is confirmed.</p>
        </div>
      </CardContent>
    </Card>
    <Card><CardHeader><div className="eyebrow">Visible clock</div><CardTitle>Move the demo date.</CardTitle></CardHeader><CardContent className="flex flex-col gap-4"><p className="text-sm leading-relaxed text-slate-500">Deadline tiers recalculate after every action. This changes only KTrack’s date, never the operating system.</p><div><label className="eyebrow" htmlFor="demo-date">Demo date</label><div className="relative mt-1.5"><CalendarDays className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-accent" /><Input id="demo-date" type="date" className="pl-9" value={state.demoDate} onChange={(event) => setDemoDate(event.target.value)} /></div></div><Badge variant="secondary">{state.alerts.filter((alert) => alert.status === "open").length} open alerts will be reconciled</Badge></CardContent></Card>
    {!IS_FLS && !IS_AMS && <><Card><CardHeader><div className="eyebrow">Deadline simulator</div><CardTitle>Exercise an active record.</CardTitle></CardHeader><CardContent className="flex flex-col gap-4"><Select aria-label="Simulation record" value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">Choose a record</option>{state.records.filter((record) => record.status === "Active").map((record) => <option key={record.id} value={record.id}>{record.assetRef} · {record.assetType}</option>)}</Select><div className="grid grid-cols-2 gap-2"><Button variant="outline" size="sm" onClick={() => shortcut(30)} disabled={!assetId}>Due in 30d</Button><Button variant="outline" size="sm" onClick={() => shortcut(7)} disabled={!assetId}>Due in 7d</Button><Button variant="outline" size="sm" onClick={() => shortcut(0)} disabled={!assetId}>Due today</Button><Button variant="outline" size="sm" onClick={() => shortcut(-1)} disabled={!assetId}>Overdue</Button></div><div className="border-t border-line pt-4"><div className="eyebrow">Review shortcut</div><p className="mt-1 text-xs text-slate-500">Creates an explicit all-pass checklist for the selected record.</p><Button className="mt-3 w-full" variant="secondary" onClick={simulateSubmitted} disabled={!assetId}><Sparkles data-icon="inline-start" />Submit demo inspection</Button></div></CardContent></Card>
    <Card><CardHeader><div className="eyebrow">Approval simulator</div><CardTitle>Issue a demo certificate.</CardTitle></CardHeader><CardContent className="flex flex-col gap-4"><p className="text-sm leading-relaxed text-slate-500">Approving creates one certificate and schedules the next inspection by its interval. Licence and retirement dates stay independent.</p><div><label className="eyebrow" htmlFor="sim-expiry">Expiry date</label><Input id="sim-expiry" type="date" className="mt-1.5" value={certificateExpiry} onChange={(event) => setCertificateExpiry(event.target.value)} /></div><Button onClick={simulateApproval} disabled={!submitted}><ShieldAlert data-icon="inline-start" />Approve submitted inspection</Button>{message && <p className="text-sm text-navy" role="status">{message}</p>}<Button asChild variant="ghost" className="justify-start px-0"><Link href="/approvals">Open approval queue <RotateCcw data-icon="inline-end" /></Link></Button></CardContent></Card></>}
    <Card className="border-[#efc4c4]"><CardHeader><div className="eyebrow text-danger">Destructive action</div><CardTitle>Reset this demo.</CardTitle></CardHeader><CardContent><p className="text-sm leading-relaxed text-slate-500">{IS_AMS ? "Puts this browser back to the sample jobs and dimension table, then returns to Dashboard." : IS_FLS ? "Clears buildings and alerts from this browser, then returns to Dashboard." : "Clears operational records, alerts, inspections and certificates from this browser, then returns to Dashboard."}</p><Button variant="destructive" className="mt-4" onClick={reset}><Trash2 data-icon="inline-start" />{IS_AMS ? "Reset to the sample jobs" : "Reset operational data"}</Button></CardContent></Card>
  </div>;
}
