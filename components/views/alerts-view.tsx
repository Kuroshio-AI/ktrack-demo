"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Check, Filter, History, RotateCcw, Send } from "lucide-react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useApp } from "@/components/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { acknowledgeAlert } from "@/lib/domain";
import { EMAIL_CC, EMAIL_RECIPIENT, getEmailJsConfig, sendAlertEmail } from "@/lib/email";
import { postWhatsAppAlert } from "@/lib/outbox";
import type { Alert } from "@/lib/types";
import { formatDate, formatDateTime } from "@/lib/utils";

type EmailFeedback = {
  state: "sending" | "sent" | "error";
  message: string;
};

type WhatsAppConfigState = {
  phase: "loading" | "ready" | "error";
  configured: boolean;
  message?: string;
};

const WHATSAPP_SETUP_KEY = "ktrack-whatsapp-configured";

// "Sent by email and WhatsApp." — one plain line instead of a provider status per channel.
function sentLine(email: boolean, whatsapp: boolean): string {
  return email && whatsapp ? "Sent by email and WhatsApp." : email ? "Sent by email." : whatsapp ? "Sent on WhatsApp." : "";
}

export function AlertsView() {
  const { state, update, storageWarning, outbox, queue } = useApp();
  const [status, setStatus] = useState("open");
  const [type, setType] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [asset, setAsset] = useState("");
  const [emailFeedback, setEmailFeedback] = useState<Record<string, EmailFeedback>>({});
  const [localAccepted, setLocalAccepted] = useState<Record<string, string>>({});
  const [whatsappStatus, setWhatsappStatus] = useState<WhatsAppConfigState>({ phase: "loading", configured: false });
  const [whatsappFeedback, setWhatsappFeedback] = useState<Record<string, EmailFeedback>>({});
  const [whatsappLocalAccepted, setWhatsappLocalAccepted] = useState<Record<string, string>>({});
  const lastEmailRequestAt = useRef(0);
  const emailInFlight = useRef(false);
  const lastWhatsAppRequestAt = useRef(0);
  const whatsappInFlight = useRef(false);
  const emailConfigured = Boolean(getEmailJsConfig());
  const isEmailSending = Object.values(emailFeedback).some((feedback) => feedback.state === "sending");
  const isWhatsAppSending = Object.values(whatsappFeedback).some((feedback) => feedback.state === "sending");
  const whatsappConfigured = whatsappStatus.phase === "ready" && whatsappStatus.configured;

  useEffect(() => {
    const controller = new AbortController();
    let ignore = false;
    fetch("/api/alerts/whatsapp", { cache: "no-store", headers: { Accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => undefined);
        if (!response.ok || !body || typeof body !== "object") throw new Error("WhatsApp Cloud API configuration is unavailable.");
        const candidate = body as Record<string, unknown>;
        try { localStorage.setItem(WHATSAPP_SETUP_KEY, String(candidate.configured === true)); } catch { /* only an offline convenience */ }
        if (!ignore) setWhatsappStatus({ phase: "ready", configured: candidate.configured === true });
      })
      .catch((reason) => {
        if (ignore || (reason instanceof DOMException && reason.name === "AbortError")) return;
        // Offline, the last answer stands, so an alert can still be queued for WhatsApp.
        let known: string | null = null;
        try { known = localStorage.getItem(WHATSAPP_SETUP_KEY); } catch { /* treated as unknown */ }
        setWhatsappStatus(!navigator.onLine && known !== null ? { phase: "ready", configured: known === "true" } : { phase: "error", configured: false, message: "WhatsApp Cloud API configuration is unavailable." });
      });
    return () => { ignore = true; controller.abort(); };
  }, []);
  const visible = useMemo(() => state.alerts
    .filter((alert) => (status === "all" || (status === "acknowledged" ? alert.status === "open" && Boolean(alert.acknowledgedAt) : alert.status === status))
      && (type === "all" || alert.type === type)
      && (severity === "all" || alert.severity === severity)
      && `${alert.assetRef ?? ""} ${alert.event} ${alert.owner ?? ""}`.toLowerCase().includes(asset.toLowerCase()))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp)), [state.alerts, status, type, severity, asset]);
  const openCount = state.alerts.filter((alert) => alert.status === "open").length;

  function tierLabel(tier: string | undefined) {
    return tier === "due30" ? "Due within 30 days" : tier === "due7" ? "Due within 7 days" : tier === "today" ? "Due today" : tier === "overdue" ? "Overdue" : tier;
  }

  function setFeedback(alertId: string, feedback: EmailFeedback) {
    setEmailFeedback((current) => ({ ...current, [alertId]: feedback }));
  }

  function setWhatsAppFeedback(alertId: string, feedback: EmailFeedback) {
    setWhatsappFeedback((current) => ({ ...current, [alertId]: feedback }));
  }

  async function sendEmail(alert: Alert) {
    const existingFeedback = emailFeedback[alert.id];
    if (existingFeedback?.state === "sending" || alert.emailSentAt || localAccepted[alert.id]) return;
    if (emailInFlight.current) {
      setFeedback(alert.id, { state: "error", message: "Another alert is still sending. Try again in a moment." });
      return;
    }
    if (!emailConfigured) {
      setFeedback(alert.id, { state: "error", message: "Email isn't set up for this demo." });
      return;
    }
    if (storageWarning) {
      setFeedback(alert.id, { state: "error", message: "This browser's storage needs recovering first (see Demo Controls). Nothing was sent." });
      return;
    }
    const now = Date.now();
    if (now - lastEmailRequestAt.current < 1_000) {
      setFeedback(alert.id, { state: "error", message: "Please wait a moment and try again." });
      return;
    }
    lastEmailRequestAt.current = now;
    emailInFlight.current = true;
    setFeedback(alert.id, { state: "sending", message: "" });

    const record = state.records.find((item) => item.id === alert.assetId);
    try {
      await sendAlertEmail({ alert, demoDate: state.demoDate, assetType: record?.assetType, site: record?.site });
      const acceptedAt = new Date().toISOString();
      const didPersist = update((current) => {
        if (!current.alerts.some((item) => item.id === alert.id)) return current;
        return { ...current, alerts: current.alerts.map((item) => item.id === alert.id ? { ...item, emailSentAt: acceptedAt } : item) };
      });
      setLocalAccepted((current) => ({ ...current, [alert.id]: acceptedAt }));
      setFeedback(alert.id, {
        state: "sent",
        message: didPersist ? "" : "Email sent, but this browser couldn't save that. Don't send it again here.",
      });
    } catch (reason) {
      setFeedback(alert.id, { state: "error", message: "Email didn't go through. Check the inbox before trying again." });
    } finally {
      emailInFlight.current = false;
    }
  }

  async function sendWhatsAppAlert(alert: Alert) {
    const existingFeedback = whatsappFeedback[alert.id];
    if (existingFeedback?.state === "sending" || alert.whatsappSentAt || whatsappLocalAccepted[alert.id]) return;
    if (whatsappInFlight.current) {
      setWhatsAppFeedback(alert.id, { state: "error", message: "Another alert is still sending. Try again in a moment." });
      return;
    }
    if (!whatsappConfigured) {
      setWhatsAppFeedback(alert.id, { state: "error", message: "WhatsApp isn't set up yet. See Demo Controls." });
      return;
    }
    if (storageWarning) {
      setWhatsAppFeedback(alert.id, { state: "error", message: "This browser's storage needs recovering first (see Demo Controls). Nothing was sent." });
      return;
    }
    const now = Date.now();
    if (now - lastWhatsAppRequestAt.current < 3_000) {
      setWhatsAppFeedback(alert.id, { state: "error", message: "WhatsApp needs a few seconds between messages. Try again shortly." });
      return;
    }
    lastWhatsAppRequestAt.current = now;
    whatsappInFlight.current = true;
    setWhatsAppFeedback(alert.id, { state: "sending", message: "" });
    const record = state.records.find((item) => item.id === alert.assetId);
    try {
      if (await postWhatsAppAlert(alert, record?.site) === "offline") throw new Error("We couldn't reach the server. Check WhatsApp before trying again.");
      const acceptedAt = new Date().toISOString();
      const didPersist = update((current) => {
        if (!current.alerts.some((item) => item.id === alert.id)) return current;
        return { ...current, alerts: current.alerts.map((item) => item.id === alert.id ? { ...item, whatsappSentAt: acceptedAt } : item) };
      });
      setWhatsappLocalAccepted((current) => ({ ...current, [alert.id]: acceptedAt }));
      setWhatsAppFeedback(alert.id, {
        state: "sent",
        message: didPersist ? "" : "WhatsApp sent, but this browser couldn't save that. Don't send it again here.",
      });
    } catch (reason) {
      setWhatsAppFeedback(alert.id, { state: "error", message: reason instanceof Error ? reason.message : "WhatsApp didn't go through. Try again." });
    } finally {
      whatsappInFlight.current = false;
    }
  }

  // One click sends every channel that is set up and hasn't gone out yet for this alert.
  // Offline, the alert waits in the outbox and goes out by itself when the laptop reconnects.
  async function sendAlert(alert: Alert, email: boolean, whatsapp: boolean) {
    if (!navigator.onLine) { queue({ kind: "alert", alertId: alert.id, email, whatsapp }); return; }
    await Promise.all([email ? sendEmail(alert) : undefined, whatsapp ? sendWhatsAppAlert(alert) : undefined]);
  }

  return <Card>
    <CardHeader className="border-b border-line">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="eyebrow">Attention queue · {openCount} open</div>
          <CardTitle>Alerts</CardTitle>
          {state.role !== "Manager" && emailConfigured && <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-500" role="status">Send alert emails {EMAIL_RECIPIENT} (CC {EMAIL_CC}) and messages the demo WhatsApp number. Nothing is sent until you click.</p>}
          {state.role !== "Manager" && !emailConfigured && <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-500" role="status">Email is not configured for this demo.</p>}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="sr-only" htmlFor="alert-status">Status</label>
          <Select id="alert-status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
            <option value="history">History</option>
            <option value="all">All status</option>
          </Select>
          <label className="sr-only" htmlFor="alert-type">Type</label>
          <Select id="alert-type" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="all">All types</option>
            <option value="deadline">Deadline</option>
            <option value="review">Review</option>
            <option value="certificate">Certificate</option>
          </Select>
          <label className="sr-only" htmlFor="alert-severity">Severity</label>
          <Select id="alert-severity" value={severity} onChange={(event) => setSeverity(event.target.value)}>
            <option value="all">All severity</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </Select>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input aria-label="Filter alerts by asset" value={asset} onChange={(event) => setAsset(event.target.value)} placeholder="Asset / owner" className="pl-9" />
          </div>
          </div>
        </div>
      {state.role !== "Manager" && <p className="text-xs leading-relaxed text-slate-500" role="status">
        {!whatsappConfigured && <>{whatsappStatus.phase === "loading" ? "Checking WhatsApp Cloud API configuration…" : whatsappStatus.message ?? "WhatsApp Cloud API is not configured."} </>}
        <Link href="/demo-controls#whatsapp-trial" className="font-semibold text-accent underline underline-offset-2">WhatsApp demo settings</Link>
      </p>}
    </CardHeader>
    <CardContent className="p-4 sm:p-5">
      {visible.length ? <div className="flex flex-col gap-2"><AnimatePresence initial={false}>
        {visible.map((alert) => {
          const feedback = emailFeedback[alert.id];
          const emailSent = Boolean(alert.emailSentAt || localAccepted[alert.id] || feedback?.state === "sent");
          const whatsappAlertFeedback = whatsappFeedback[alert.id];
          const whatsappSent = Boolean(alert.whatsappSentAt || whatsappLocalAccepted[alert.id] || whatsappAlertFeedback?.state === "sent");
          const emailPending = emailConfigured && !emailSent;
          const whatsappPending = whatsappConfigured && !whatsappSent;
          const sending = feedback?.state === "sending" || whatsappAlertFeedback?.state === "sending";
          const queued = outbox.some((item) => item.kind === "alert" && item.alertId === alert.id);
          const notes = [feedback, whatsappAlertFeedback].filter((item, index, all): item is EmailFeedback => Boolean(item?.message && item.state !== "sending" && all.findIndex((other) => other?.message === item.message) === index));
          return <motion.div key={alert.id} layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.45 }} className={`flex flex-col gap-3 rounded-lg border px-3 py-3 sm:flex-row sm:items-center sm:justify-between ${alert.status === "open" ? "border-line bg-white" : "border-line bg-paper opacity-80"}`}>
            <div className="flex min-w-0 items-start gap-3">
              <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-md ${alert.severity === "critical" ? "bg-[#fde8e8] text-danger" : alert.severity === "warning" ? "bg-[#fff2d7] text-[#8a5d00]" : "bg-[#e8f3f8] text-accent"}`}>
                {alert.status === "resolved" ? <Check className="size-4" /> : alert.status === "history" ? <History className="size-4" /> : <BellRing className="size-4" />}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-navy">
                  <Link href={alert.assetId ? `/register?asset=${alert.assetId}` : "/alerts"} className="underline-offset-2 hover:underline">{alert.event}</Link>
                  <Badge variant="outline">{alert.severity}</Badge>
                  {alert.tier && <Badge variant={alert.tier === "overdue" ? "danger" : alert.tier === "due30" ? "secondary" : "warning"}>{tierLabel(alert.tier)}</Badge>}
                </div>
                <div className="mt-1 text-xs text-slate-500">{alert.assetRef ?? "System"}{alert.owner ? ` · ${alert.owner}` : ""}{alert.dueDate ? ` · due ${formatDate(alert.dueDate)}` : ""}</div>
                <div className="mt-1 text-[10px] uppercase tracking-[.08em] text-slate-400">{formatDateTime(alert.timestamp)}{alert.acknowledgedBy && alert.acknowledgedAt ? ` · acknowledged by ${alert.acknowledgedBy} at ${formatDateTime(alert.acknowledgedAt)}` : ""}</div>
                <div aria-live="polite">
                  {(emailSent || whatsappSent) && <div className="mt-2 text-xs font-medium text-[#187348]" role="status">{sentLine(emailSent, whatsappSent)}</div>}
                  {queued && <div className="mt-2 text-xs font-medium text-[#8a5d00]" role="status">Waits for the connection. It goes out by itself when this laptop is back online.</div>}
                  {notes.map((note) => <div key={note.message} className={`mt-1 text-xs ${note.state === "error" ? "text-danger" : "text-[#8a5d00]"}`} role={note.state === "error" ? "alert" : "status"}>{note.message}</div>)}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {state.role !== "Manager" && alert.status === "open" && !alert.acknowledgedAt && <Button variant="outline" size="sm" onClick={() => update((current) => acknowledgeAlert(current, alert.id))}><Check data-icon="inline-start" />Acknowledge</Button>}
              {state.role !== "Manager" && (emailConfigured || whatsappConfigured) && <Button variant="outline" size="sm" disabled={Boolean(storageWarning) || isEmailSending || isWhatsAppSending || queued || (!emailPending && !whatsappPending)} onClick={() => void sendAlert(alert, emailPending, whatsappPending)}><Send data-icon="inline-start" />{sending ? "Sending…" : queued ? "Queued" : !emailPending && !whatsappPending ? "Sent" : emailSent || whatsappSent ? "Retry" : "Send alert"}</Button>}
              {alert.status === "resolved" && <span className="flex items-center gap-1 text-xs font-semibold text-[#187348]"><RotateCcw className="size-3" />Resolved by condition</span>}
            </div>
          </motion.div>;
        })}
      </AnimatePresence></div> : <div className="flex flex-col items-center justify-center px-4 py-16 text-center"><BellRing className="size-10 text-[#b8cedc]" /><h2 className="mt-4 font-semibold text-navy">No alerts in this view</h2><p className="mt-2 text-sm text-slate-500">Try a different filter or change the demo date.</p></div>}
    </CardContent>
  </Card>;
}
