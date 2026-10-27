import assert from "node:assert/strict";
import test from "node:test";
import {
  handleWhatsAppGet,
  handleWhatsAppPost,
  handleWhatsAppTokenPost,
  resetWhatsAppRuntimeForTests,
  type WhatsAppFetch,
} from "./whatsapp";

const baseUrl = "https://keetrack.example/api/alerts/whatsapp";
const env = {
  META_WHATSAPP_ACCESS_TOKEN: "EAAB-test-token",
  META_WHATSAPP_PHONE_NUMBER_ID: "123456789012345",
  META_WHATSAPP_TO: "+15551234567",
  META_APP_SECRET: "app-secret",
  META_WHATSAPP_VERIFY_TOKEN: "verify-token",
};
const messageId = "wamid.HBg+LMTU1NTEyMzQ1Njc/==";
const alertPayload = {
  alertId: "alert-1",
  event: "Inspection due",
  assetRef: "ANC-201",
  site: "Northpoint Works",
  severity: "warning",
  dueDate: "2026-10-12",
} as const;

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(baseUrl, {
    method: "POST",
    headers: {
      Origin: "https://keetrack.example",
      Host: "keetrack.example",
      "Content-Type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function acceptedFetch(calls: Array<{ input: RequestInfo | URL; init?: RequestInit }>, status = "accepted"): WhatsAppFetch {
  return async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: messageId, message_status: status }] }), { status: 200 });
  };
}

test.beforeEach(() => resetWhatsAppRuntimeForTests());

test("GET exposes safe Meta settings and defaults", async () => {
  const response = await handleWhatsAppGet(env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(body, {
    configured: true,
    provider: "Meta",
    webhookConfigured: true,
    tokenUpdatable: false,
    recipientLabel: "WhatsApp ending in •••• 4567",
    templateName: "keetrack_asset_alert",
    templateLanguage: "en_US",
    tokenSource: "server",
  });
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes(env.META_WHATSAPP_ACCESS_TOKEN), false);
  assert.equal(serialized.includes(env.META_WHATSAPP_PHONE_NUMBER_ID), false);
  assert.deepEqual(await (await handleWhatsAppGet({})).json(), { configured: false, provider: "Meta", webhookConfigured: false, tokenUpdatable: false });
});

const storeEnv = { ...env, KV_REST_API_URL: "https://store.example", KV_REST_API_TOKEN: "store-token" };
const savedToken = "EAA" + "s".repeat(40);

function storeFetch(saved: string | null, graphStatus: number, commands: string[][], sends: Array<RequestInit | undefined> = []): WhatsAppFetch {
  return async (input, init) => {
    const url = String(input);
    if (url === storeEnv.KV_REST_API_URL) {
      const command = JSON.parse(String(init?.body)) as string[];
      commands.push(command);
      return Response.json({ result: command[0] === "GET" ? saved : "OK" });
    }
    if (url.endsWith("?fields=id")) return Response.json({ id: env.META_WHATSAPP_PHONE_NUMBER_ID }, { status: graphStatus });
    sends.push(init);
    return Response.json({ messaging_product: "whatsapp", messages: [{ id: messageId }] });
  };
}

function tokenRequest(body: unknown, origin = "https://keetrack.example"): Request {
  return new Request("https://keetrack.example/api/alerts/whatsapp/token", {
    method: "POST",
    headers: { Origin: origin, Host: "keetrack.example", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("token updates are saved only after Meta confirms the configured number", async () => {
  const commands: string[][] = [];
  assert.equal((await handleWhatsAppTokenPost(tokenRequest({ token: savedToken }), { env, fetch: storeFetch(null, 200, commands) })).status, 503);
  assert.equal((await handleWhatsAppTokenPost(tokenRequest({ token: savedToken }, "https://evil.example"), { env: storeEnv, fetch: storeFetch(null, 200, commands) })).status, 403);
  assert.equal((await handleWhatsAppTokenPost(tokenRequest({ token: "not a token" }), { env: storeEnv, fetch: storeFetch(null, 200, commands), now: () => 1_000 })).status, 400);
  resetWhatsAppRuntimeForTests();
  const rejected = await handleWhatsAppTokenPost(tokenRequest({ token: savedToken }), { env: storeEnv, fetch: storeFetch(null, 401, commands), now: () => 1_000 });
  assert.equal(rejected.status, 400);
  assert.equal(commands.length, 0);
  assert.equal((await handleWhatsAppTokenPost(tokenRequest({ token: savedToken }), { env: storeEnv, fetch: storeFetch(null, 200, commands), now: () => 1_001 })).status, 429);
  const saved = await handleWhatsAppTokenPost(tokenRequest({ token: ` ${savedToken} ` }), { env: storeEnv, fetch: storeFetch(null, 200, commands), now: () => 4_001 });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { saved: true });
  assert.deepEqual(commands, [["SET", "keetrack:meta-whatsapp-access-token", savedToken]]);
});

test("a saved website token is used for sends and reported without exposing it", async () => {
  const sends: Array<RequestInit | undefined> = [];
  const fetch = storeFetch(savedToken, 200, [], sends);
  const body = await (await handleWhatsAppGet(storeEnv, fetch)).json() as Record<string, unknown>;
  assert.equal(body.tokenUpdatable, true);
  assert.equal(body.tokenSource, "website");
  assert.equal(JSON.stringify(body).includes(savedToken), false);
  assert.equal((await handleWhatsAppPost(request(alertPayload), { env: storeEnv, fetch, now: () => 1_000 })).status, 200);
  assert.equal(new Headers(sends[0]?.headers).get("authorization"), `Bearer ${savedToken}`);
});

test("missing or invalid provider configuration fails before any Meta fetch", async () => {
  let calls = 0;
  const invalidEnvs = [
    {},
    { ...env, META_WHATSAPP_ACCESS_TOKEN: "token with whitespace" },
    { ...env, META_WHATSAPP_PHONE_NUMBER_ID: "sender-id" },
    { ...env, META_WHATSAPP_TO: "whatsapp:+15551234567" },
    { ...env, META_WHATSAPP_TO: "+15551234567,whatsapp:+971501234567" },
    { ...env, META_WHATSAPP_TEMPLATE_NAME: "hello world" },
    { ...env, META_GRAPH_API_VERSION: "v26" },
  ];
  for (const invalidEnv of invalidEnvs) {
    const response = await handleWhatsAppPost(request(alertPayload), { env: invalidEnv, fetch: async () => { calls += 1; return new Response(); } });
    assert.equal(response.status, 503);
  }
  assert.equal(calls, 0);
});

test("same-origin, content type, request shape and size guards are preserved", async () => {
  const wrongOrigin = await handleWhatsAppPost(request(alertPayload, { Origin: "https://evil.example" }), { env });
  assert.equal(wrongOrigin.status, 403);
  const wrongType = await handleWhatsAppPost(request(alertPayload, { "Content-Type": "text/plain" }), { env });
  assert.equal(wrongType.status, 415);
  const extraField = await handleWhatsAppPost(request({ ...alertPayload, owner: "private" }), { env });
  assert.equal(extraField.status, 400);
  const missingField = await handleWhatsAppPost(request(({ ...alertPayload, site: undefined })), { env });
  assert.equal(missingField.status, 400);
  const oversized = await handleWhatsAppPost(request({ ...alertPayload, event: "x".repeat(2_100) }), { env });
  assert.equal(oversized.status, 413);
});

test("strict alert payload validation rejects controls, invalid severity and invalid dates", async () => {
  const invalidPayloads = [
    { ...alertPayload, event: "Inspection\nDue" },
    { ...alertPayload, event: "x".repeat(161) },
    { ...alertPayload, site: "   " },
    { ...alertPayload, severity: "urgent" },
    { ...alertPayload, dueDate: "2026-02-30" },
    { ...alertPayload, dueDate: "12/10/2026" },
    { ...alertPayload, assetRef: 42 },
  ];
  for (const payload of invalidPayloads) {
    const response = await handleWhatsAppPost(request(payload), { env, fetch: async () => { throw new Error("provider must not run"); } });
    assert.equal(response.status, 400);
  }
  const absentDetails = await handleWhatsAppPost(request({ ...alertPayload, assetRef: "Not applicable", site: "Not applicable", dueDate: "Not applicable" }), { env, fetch: acceptedFetch([]), now: () => 1_000 });
  assert.equal(absentDetails.status, 200);
});

test("same-origin uses the actual Host header when Next normalizes Request.url", async () => {
  const localRequest = new Request("http://localhost:3001/api/alerts/whatsapp", {
    method: "POST",
    headers: {
      Origin: "http://127.0.0.1:3001",
      Host: "127.0.0.1:3001",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...alertPayload, alertId: "host-header" }),
  });
  const accepted = await handleWhatsAppPost(localRequest, { env, fetch: acceptedFetch([]), now: () => 1_000 });
  assert.equal(accepted.status, 200);

  resetWhatsAppRuntimeForTests();
  const hostileOrigin = new Request("http://localhost:3001/api/alerts/whatsapp", {
    method: "POST",
    headers: {
      Origin: "http://localhost:3001",
      Host: "127.0.0.1:3001",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...alertPayload, alertId: "host-header" }),
  });
  assert.equal((await handleWhatsAppPost(hostileOrigin, { env, fetch: acceptedFetch([]), now: () => 1_000 })).status, 403);
});

test("accepted Meta responses send exactly five approved parameters from the request", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const response = await handleWhatsAppPost(request(alertPayload), { env, fetch: acceptedFetch(calls), now: () => 1_000 });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: true, status: "accepted" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "https://graph.facebook.com/v26.0/123456789012345/messages");
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get("authorization"), `Bearer ${env.META_WHATSAPP_ACCESS_TOKEN}`);
  const body = JSON.parse(String(calls[0].init?.body)) as Record<string, any>;
  assert.deepEqual(body, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "15551234567",
    type: "template",
    template: {
      name: "keetrack_asset_alert",
      language: { code: "en_US" },
      components: [{
        type: "body",
        parameters: [
          { type: "text", text: "Inspection due" },
          { type: "text", text: "ANC-201" },
          { type: "text", text: "Northpoint Works" },
          { type: "text", text: "warning" },
          { type: "text", text: "2026-10-12" },
        ],
      }],
    },
  });
  assert.equal(JSON.stringify(body).includes("private"), false);
});

test("several recipients each get the alert, and a partial send stays unconfirmed", async () => {
  const twoEnv = { ...env, META_WHATSAPP_TO: "+15551234567, +971501234567" };
  assert.equal((await (await handleWhatsAppGet(twoEnv)).json() as Record<string, unknown>).recipientLabel, "WhatsApp ending in •••• 4567, •••• 4567");
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  assert.equal((await handleWhatsAppPost(request(alertPayload), { env: twoEnv, fetch: acceptedFetch(calls), now: () => 1_000 })).status, 200);
  assert.deepEqual(calls.map(({ init }) => JSON.parse(String(init?.body)).to), ["15551234567", "971501234567"]);
  resetWhatsAppRuntimeForTests();
  const partial: WhatsAppFetch = async (input, init) => JSON.parse(String(init?.body)).to === "971501234567" ? new Response("{}", { status: 400 }) : acceptedFetch([])(input, init);
  assert.equal((await handleWhatsAppPost(request(alertPayload), { env: twoEnv, fetch: partial, now: () => 1_000 })).status, 503);
});

test("held and paused Meta submissions are accepted without claiming delivery", async () => {
  for (const status of ["held_for_quality_assessment", "paused"]) {
    resetWhatsAppRuntimeForTests();
    const response = await handleWhatsAppPost(request({ ...alertPayload, alertId: status }), { env, fetch: acceptedFetch([], status), now: () => 1_000 });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, status: "accepted" });
  }
});

test("success replay is deduplicated and cooldown applies per instance", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetch = acceptedFetch(calls);
  assert.equal((await handleWhatsAppPost(request(alertPayload), { env, fetch, now: () => 1_000 })).status, 200);
  assert.equal((await handleWhatsAppPost(request(alertPayload), { env, fetch, now: () => 1_001 })).status, 200);
  assert.equal((await handleWhatsAppPost(request({ ...alertPayload, alertId: "alert-2" }), { env, fetch, now: () => 1_002 })).status, 429);
  assert.equal(calls.length, 1);
  assert.equal((await handleWhatsAppPost(request({ ...alertPayload, alertId: "alert-2" }), { env, fetch, now: () => 4_001 })).status, 200);
  assert.equal(calls.length, 2);
});

test("ambiguous provider results are cached and never claim delivery", async () => {
  let calls = 0;
  const fetch: WhatsAppFetch = async () => { calls += 1; throw new Error("network"); };
  const first = await handleWhatsAppPost(request(alertPayload), { env, fetch, now: () => 1_000 });
  const second = await handleWhatsAppPost(request(alertPayload), { env, fetch, now: () => 1_001 });
  assert.equal(first.status, 503);
  assert.deepEqual(await first.clone().json(), { error: "WhatsApp status is unconfirmed. Check Meta before retrying." });
  assert.equal(second.status, 503);
  assert.deepEqual(await second.json(), { error: "WhatsApp status is unconfirmed. Check Meta before retrying." });
  assert.equal(calls, 1);
});

test("provider rejection and malformed successful responses are redacted or unconfirmed", async () => {
  const rejected = await handleWhatsAppPost(request(alertPayload), { env, fetch: async () => new Response("secret provider body", { status: 401 }), now: () => 1_000 });
  assert.equal(rejected.status, 502);
  assert.deepEqual(await rejected.json(), { error: "Meta rejected the WhatsApp message request; no acceptance was returned." });
  resetWhatsAppRuntimeForTests();
  const malformed = await handleWhatsAppPost(request(alertPayload), { env, fetch: async () => new Response(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: "not-a-wamid" }] }), { status: 200 }), now: () => 1_000 });
  assert.equal(malformed.status, 503);
  assert.equal((await malformed.json()).error?.toString().includes("secret"), false);
  resetWhatsAppRuntimeForTests();
  const unknownStatus = await handleWhatsAppPost(request(alertPayload), { env, fetch: async () => new Response(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: messageId, message_status: "delivered" }] }), { status: 200 }), now: () => 1_000 });
  assert.equal(unknownStatus.status, 503);
});
