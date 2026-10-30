import { sendAlertEmail, type EmailJsConfig } from "./email";
import type { Alert, AppState, CertificateStatus } from "./types";

// Work that needs our server: a report's new status for the QR codes already printed, and an alert's email or WhatsApp
// message. Offline it waits here, in its own localStorage key so a closed laptop keeps it, and goes out when the
// connection returns. Tally sheets themselves never wait: they live on the laptop.
export const OUTBOX_KEY = "ktrack-outbox";

export type OutboxItem =
  | { kind: "status"; statusKey: string; status: CertificateStatus; certificateNo: string }
  | { kind: "alert"; alertId: string; email: boolean; whatsapp: boolean };

const isItem = (value: unknown): value is OutboxItem => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.kind === "status" ? typeof item.statusKey === "string" && (item.status === "Revoked" || item.status === "Superseded") && typeof item.certificateNo === "string"
    : item.kind === "alert" && typeof item.alertId === "string" && typeof item.email === "boolean" && typeof item.whatsapp === "boolean";
};

export function loadOutbox(storage: Pick<Storage, "getItem">): OutboxItem[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(OUTBOX_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isItem) : [];
  } catch { return []; }
}

export function saveOutbox(storage: Pick<Storage, "setItem">, items: OutboxItem[]): void {
  storage.setItem(OUTBOX_KEY, JSON.stringify(items));
}

// A report's latest status replaces an older one still waiting; a second send of the same alert adds its channels.
export function enqueue(items: OutboxItem[], item: OutboxItem): OutboxItem[] {
  if (item.kind === "status") return [...items.filter((other) => other.kind !== "status" || other.statusKey !== item.statusKey), item];
  const waiting = items.find((other): other is Extract<OutboxItem, { kind: "alert" }> => other.kind === "alert" && other.alertId === item.alertId);
  if (!waiting) return [...items, item];
  return items.map((other) => other === waiting ? { ...waiting, email: waiting.email || item.email, whatsapp: waiting.whatsapp || item.whatsapp } : other);
}

// Reports whose QR codes are out there (they have a status key) and that were just revoked or superseded.
export function statusChanges(before: AppState, after: AppState): OutboxItem[] {
  const previous = new Map(before.records.flatMap((record) => record.certificates).map((certificate) => [certificate.id, certificate.status]));
  return after.records.flatMap((record) => record.certificates)
    .filter((certificate) => certificate.statusKey && certificate.status !== previous.get(certificate.id) && (certificate.status === "Revoked" || certificate.status === "Superseded"))
    .map((certificate) => ({ kind: "status", statusKey: certificate.statusKey!, status: certificate.status, certificateNo: certificate.number }));
}

export function whatsappError(status: number, serverMessage: string | undefined): string {
  if (status === 429) return "WhatsApp needs a few seconds between messages. Try again shortly.";
  if (status === 502) return "WhatsApp didn't accept the message. The access token may have expired; update it in Demo Controls.";
  if (status === 503 && serverMessage?.includes("not configured")) return "WhatsApp isn't set up yet. See Demo Controls.";
  if (status === 503) return "We couldn't confirm the WhatsApp message. Check WhatsApp before trying again.";
  return serverMessage ?? "WhatsApp didn't go through. Try again.";
}

// Sends one alert over WhatsApp through our server. "offline" means the request never reached it; a refusal throws.
export async function postWhatsAppAlert(alert: Alert, site: string | undefined, fetchImpl: typeof fetch = fetch): Promise<"offline" | "sent"> {
  const payload = { alertId: alert.id, event: alert.event, assetRef: alert.assetRef?.trim() || "Not applicable", site: site?.trim() || "Not applicable", severity: alert.severity, dueDate: alert.dueDate ?? "Not applicable" };
  const response = await fetchImpl("/api/alerts/whatsapp", { method: "POST", cache: "no-store", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => undefined);
  if (!response) return "offline";
  const body: unknown = await response.json().catch(() => undefined);
  const fields = body && typeof body === "object" ? body as Record<string, unknown> : undefined;
  if (!response.ok || fields?.accepted !== true) throw new Error(whatsappError(response.status, typeof fields?.error === "string" ? fields.error : undefined));
  return "sent";
}

export type Delivery = {
  // What still waits, when the connection dropped part way.
  left?: OutboxItem;
  sent?: { alertId: string; email?: string; whatsapp?: string };
  error?: string;
};

type DeliverOptions = { fetch?: typeof fetch; online?: () => boolean; emailConfig?: EmailJsConfig; now?: () => string };

export async function deliver(item: OutboxItem, state: AppState, options: DeliverOptions = {}): Promise<Delivery> {
  const fetchImpl = options.fetch ?? fetch;
  const online = options.online ?? (() => navigator.onLine);
  const now = options.now ?? (() => new Date().toISOString());
  if (item.kind === "status") {
    const response = await fetchImpl("/api/certificates/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ statusKey: item.statusKey, status: item.status }) }).catch(() => undefined);
    if (!response) return { left: item };
    return response.ok ? {} : { error: `${item.certificateNo} changed here, but QR codes already printed for it still show the old status.` };
  }
  const alert = state.alerts.find((candidate) => candidate.id === item.alertId);
  if (!alert) return {};
  const record = state.records.find((candidate) => candidate.id === alert.assetId);
  const sent: NonNullable<Delivery["sent"]> = { alertId: alert.id };
  const errors: string[] = [];
  if (item.email && !alert.emailSentAt) {
    try {
      await sendAlertEmail({ alert, demoDate: state.demoDate, assetType: record?.assetType, site: record?.site }, { fetch: fetchImpl, config: options.emailConfig });
      sent.email = now();
    } catch {
      if (!online()) return { left: item, sent };
      errors.push("The alert email didn't go through. Check the inbox before sending it again.");
    }
  }
  if (item.whatsapp && !alert.whatsappSentAt) {
    try {
      if (await postWhatsAppAlert(alert, record?.site, fetchImpl) === "offline") return { left: { ...item, email: false }, sent };
      sent.whatsapp = now();
    } catch (reason) { errors.push(reason instanceof Error ? reason.message : "WhatsApp didn't go through. Try again."); }
  }
  return { sent, error: errors.join(" ") || undefined };
}
