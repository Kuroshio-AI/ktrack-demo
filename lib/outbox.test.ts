import { strict as assert } from "node:assert";
import test from "node:test";
import { createInitialState } from "./domain";
import { deliver, enqueue, loadOutbox, OUTBOX_KEY, statusChanges, type OutboxItem } from "./outbox";
import type { EmailJsConfig } from "./email";
import type { Alert, AppState, AssetRecord } from "./types";

const emailConfig: EmailJsConfig = { serviceId: "service-demo", templateId: "template-keetrack", publicKey: "public-demo" };
const status: OutboxItem = { kind: "status", statusKey: "key-1", status: "Revoked", certificateNo: "CERT-1" };
const offlineFetch = (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;
const reply = (status: number, body: unknown = {}) => Promise.resolve(new Response(JSON.stringify(body), { status }));

// One asset with one certificate, and one open alert on it. Only the fields the outbox reads are filled in.
const certificate = { id: "cert-1", number: "CERT-1", status: "Valid" };
const record = { id: "asset-1", assetType: "Guardrail", site: "Yard 2", certificates: [certificate] } as unknown as AssetRecord;
const alert = { id: "alert-1", type: "deadline", event: "Inspection due soon", assetId: "asset-1", assetRef: "HAR-001", severity: "warning", status: "open", timestamp: "2026-10-30T08:00:00.000Z" } as unknown as Alert;
const workspace: AppState = { ...createInitialState("2026-10-30"), records: [record], alerts: [alert] };

function withAlert(): { state: AppState; alertId: string } {
  return { state: workspace, alertId: alert.id };
}

test("the outbox keeps a report's latest status and merges a second send of an alert", () => {
  const revoked = enqueue([], status);
  assert.deepEqual(enqueue(revoked, { ...status, status: "Superseded" }), [{ ...status, status: "Superseded" }]);
  const email = enqueue([], { kind: "alert", alertId: "a1", email: true, whatsapp: false });
  assert.deepEqual(enqueue(email, { kind: "alert", alertId: "a1", email: false, whatsapp: true }), [{ kind: "alert", alertId: "a1", email: true, whatsapp: true }]);
  const stored = new Map([[OUTBOX_KEY, JSON.stringify([status, { kind: "alert", alertId: 3 }, "junk"])]]);
  assert.deepEqual(loadOutbox({ getItem: (key) => stored.get(key) ?? null }), [status], "anything malformed in storage is dropped");
  assert.deepEqual(loadOutbox({ getItem: () => "{not json" }), []);
});

test("only a report with QR codes out there queues its new status", () => {
  const before = workspace;
  const revoke = (statusKey?: string): AppState => ({ ...before, records: before.records.map((item) => item.id === record.id ? { ...item, certificates: item.certificates.map((cert) => cert.id === certificate.id ? { ...cert, status: "Revoked", statusKey } : cert) } : item) });
  assert.deepEqual(statusChanges(before, revoke()), [], "no QR was ever made for it");
  assert.deepEqual(statusChanges(before, revoke("key-9")), [{ kind: "status", statusKey: "key-9", status: "Revoked", certificateNo: certificate.number }]);
});

test("a status waits while offline, goes once the server answers, and reports a refusal", async () => {
  const state = createInitialState("2026-10-30");
  assert.deepEqual(await deliver(status, state, { fetch: offlineFetch }), { left: status });
  assert.deepEqual(await deliver(status, state, { fetch: () => reply(200) }), {});
  assert.match((await deliver(status, state, { fetch: () => reply(500) })).error ?? "", /CERT-1 changed here/);
});

test("an alert sends its email, and its WhatsApp waits when the connection drops in between", async () => {
  const { state, alertId } = withAlert();
  const item: OutboxItem = { kind: "alert", alertId, email: true, whatsapp: true };
  const calls: string[] = [];
  const fetchImpl = ((url: string) => { calls.push(String(url)); return String(url).includes("emailjs") ? reply(200) : Promise.reject(new TypeError("Failed to fetch")); }) as typeof fetch;
  const result = await deliver(item, state, { fetch: fetchImpl, emailConfig, online: () => false, now: () => "2026-10-30T09:00:00.000Z" });
  assert.deepEqual(result, { left: { ...item, email: false }, sent: { alertId, email: "2026-10-30T09:00:00.000Z" } });
  assert.equal(calls.length, 2);
  const sentState = { ...state, alerts: state.alerts.map((alert) => alert.id === alertId ? { ...alert, emailSentAt: "2026-10-30T09:00:00.000Z" } : alert) };
  const whatsapp = await deliver(result.left!, sentState, { fetch: () => reply(200, { accepted: true }), emailConfig, now: () => "2026-10-30T09:05:00.000Z" });
  assert.deepEqual(whatsapp, { sent: { alertId, whatsapp: "2026-10-30T09:05:00.000Z" }, error: undefined });
  assert.deepEqual(await deliver({ ...item, alertId: "gone" }, state, { fetch: offlineFetch }), {}, "a deleted alert drops out");
});
