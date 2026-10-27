export const META_GRAPH_API_BASE_URL = "https://graph.facebook.com";
export const WHATSAPP_MAX_BODY_BYTES = 2_048;
export const WHATSAPP_COOLDOWN_MS = 3_000;
export const WHATSAPP_REPLAY_TTL_MS = 10 * 60 * 1_000;
export const WHATSAPP_REPLAY_MAX = 500;
export const WHATSAPP_NOT_APPLICABLE = "Not applicable";

const DEFAULT_GRAPH_API_VERSION = "v26.0";
const DEFAULT_TEMPLATE_NAME = "keetrack_asset_alert";
const DEFAULT_TEMPLATE_LANGUAGE = "en_US";
const ALERT_TEXT_MAX_LENGTH = 160;
const alertIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const phoneNumberIdPattern = /^\d{1,32}$/;
const recipientPattern = /^\+?[1-9]\d{7,14}$/;
const templateNamePattern = /^[a-z0-9](?:[a-z0-9_]{0,254})$/;
const templateLanguagePattern = /^[A-Za-z]{2,3}(?:[_-][A-Za-z0-9]{2,8})?$/;
const graphApiVersionPattern = /^v\d{1,3}\.\d{1,3}$/;
const wamidPattern = /^wamid\.[^\s\u0000-\u001f\u007f]{1,511}$/;
const accessTokenPattern = /^EAA[A-Za-z0-9]{20,4093}$/;
const TOKEN_STORE_KEY = "keetrack:meta-whatsapp-access-token";

type Environment = Readonly<Record<string, string | undefined>>;

export type WhatsAppConfig = Readonly<{
  accessToken: string;
  phoneNumberId: string;
  to: readonly string[];
  templateName: string;
  templateLanguage: string;
  graphApiVersion: string;
}>;

export type WhatsAppAlertPayload = Readonly<{
  alertId: string;
  event: string;
  assetRef: string;
  site: string;
  severity: "info" | "warning" | "critical";
  dueDate: string;
}>;

export type WhatsAppFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type HandlerOptions = {
  env?: Environment;
  fetch?: WhatsAppFetch;
  now?: () => number;
};

type CachedResponse = {
  expiresAt: number;
  status: number;
  body: Record<string, unknown>;
};

type ProviderResult =
  | { kind: "accepted" }
  | { kind: "rejected" }
  | { kind: "ambiguous" };

let lastAttemptAt: number | undefined;
let inFlight = false;
let lastTokenAttemptAt: number | undefined;
const replayCache = new Map<string, CachedResponse>();

// ponytail: unauthenticated public demo with fixed server-side recipients. The guard only limits a warm instance;
// add authentication and shared rate limiting before expanding access or letting the browser pick recipients.
export function resetWhatsAppRuntimeForTests(): void {
  lastAttemptAt = undefined;
  inFlight = false;
  lastTokenAttemptAt = undefined;
  replayCache.clear();
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
  });
}

function rawValue(env: Environment, name: string): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalValue(env: Environment, name: string, fallback: string): string {
  const value = rawValue(env, name);
  return value && value.trim().length > 0 ? value : fallback;
}

function hasForbiddenHeaderCharacters(value: string): boolean {
  return /[\s\u0000-\u001f\u007f]/.test(value);
}

function isValidWebhookSetting(value: string | undefined): value is string {
  return Boolean(value && value.length <= 4_096 && !/[\r\n\u0000]/.test(value));
}

export function isWhatsAppWebhookConfigValid(env: Environment = process.env): boolean {
  return isValidWebhookSetting(rawValue(env, "META_APP_SECRET")) && isValidWebhookSetting(rawValue(env, "META_WHATSAPP_VERIFY_TOKEN"));
}

export function getWhatsAppConfig(env: Environment = process.env): WhatsAppConfig | undefined {
  const accessToken = rawValue(env, "META_WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = rawValue(env, "META_WHATSAPP_PHONE_NUMBER_ID");
  // One number, or several separated by commas; every alert goes to all of them.
  const recipients = rawValue(env, "META_WHATSAPP_TO")?.split(",").map((value) => value.trim());
  const templateName = optionalValue(env, "META_WHATSAPP_TEMPLATE_NAME", DEFAULT_TEMPLATE_NAME);
  const templateLanguage = optionalValue(env, "META_WHATSAPP_TEMPLATE_LANGUAGE", DEFAULT_TEMPLATE_LANGUAGE);
  const graphApiVersion = optionalValue(env, "META_GRAPH_API_VERSION", DEFAULT_GRAPH_API_VERSION);

  if (!accessToken || hasForbiddenHeaderCharacters(accessToken) || accessToken.length > 4_096) return undefined;
  if (!phoneNumberId || !phoneNumberIdPattern.test(phoneNumberId)) return undefined;
  if (!recipients?.every((value) => recipientPattern.test(value))) return undefined;
  if (!templateNamePattern.test(templateName) || !templateLanguagePattern.test(templateLanguage) || !graphApiVersionPattern.test(graphApiVersion)) return undefined;

  return {
    accessToken,
    phoneNumberId,
    to: recipients.map((value) => value.replace(/^\+/, "")),
    templateName,
    templateLanguage,
    graphApiVersion,
  };
}

type TokenStore = Readonly<{ url: string; token: string }>;

// Upstash Redis REST settings, added to the project by the Vercel Marketplace integration.
function getTokenStore(env: Environment): TokenStore | undefined {
  const url = rawValue(env, "KV_REST_API_URL");
  const token = rawValue(env, "KV_REST_API_TOKEN");
  if (!url?.startsWith("https://") || !token || hasForbiddenHeaderCharacters(token)) return undefined;
  return { url: url.replace(/\/+$/, ""), token };
}

function isTokenUpdatable(env: Environment): boolean {
  return Boolean(getTokenStore(env) && phoneNumberIdPattern.test(rawValue(env, "META_WHATSAPP_PHONE_NUMBER_ID") ?? ""));
}

async function storeCommand(store: TokenStore, command: string[], fetchImpl: WhatsAppFetch): Promise<unknown> {
  const response = await fetchImpl(store.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${store.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("token-store");
  const value: unknown = await response.json();
  return isRecord(value) ? value.result : undefined;
}

// A token saved from Demo Controls overrides META_WHATSAPP_ACCESS_TOKEN.
async function resolveWhatsAppConfig(env: Environment, fetchImpl: WhatsAppFetch): Promise<{ config?: WhatsAppConfig; tokenSource: "website" | "server" }> {
  const store = getTokenStore(env);
  if (store) {
    try {
      const saved = await storeCommand(store, ["GET", TOKEN_STORE_KEY], fetchImpl);
      if (typeof saved === "string" && accessTokenPattern.test(saved)) return { config: getWhatsAppConfig({ ...env, META_WHATSAPP_ACCESS_TOKEN: saved }), tokenSource: "website" };
    } catch {
      // ponytail: an unreachable store falls back to the server token rather than blocking sends.
    }
  }
  return { config: getWhatsAppConfig(env), tokenSource: "server" };
}

function sameOrigin(request: Request): boolean {
  const supplied = request.headers.get("origin");
  if (!supplied) return false;
  try {
    const requestUrl = new URL(request.url);
    if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") return false;
    const hostHeader = request.headers.get("host");
    const host = hostHeader?.trim();
    if (hostHeader !== null && !host) return false;
    const expectedUrl = host ? new URL(`${requestUrl.protocol}//${host}`) : new URL(requestUrl.origin);
    const suppliedUrl = new URL(supplied);
    if (suppliedUrl.protocol !== "http:" && suppliedUrl.protocol !== "https:") return false;
    if (expectedUrl.username || expectedUrl.password || suppliedUrl.username || suppliedUrl.password) return false;
    if (expectedUrl.pathname !== "/" || expectedUrl.search || expectedUrl.hash || suppliedUrl.pathname !== "/" || suppliedUrl.search || suppliedUrl.hash) return false;
    return suppliedUrl.origin === expectedUrl.origin;
  } catch {
    return false;
  }
}

async function readBoundedBody(request: Request): Promise<string> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number.isSafeInteger(Number(declaredLength)) && Number(declaredLength) > WHATSAPP_MAX_BODY_BYTES) throw new Error("too-large");
  if (!request.body) {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > WHATSAPP_MAX_BODY_BYTES) throw new Error("too-large");
    return text;
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > WHATSAPP_MAX_BODY_BYTES) throw new Error("too-large");
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function isSafeSingleLineText(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= ALERT_TEXT_MAX_LENGTH
    && value.trim().length > 0
    && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value);
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const payloadKeys = ["alertId", "event", "assetRef", "site", "severity", "dueDate"] as const;

function parseAlertPayload(text: string): WhatsAppAlertPayload | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const candidate = value as Record<string, unknown>;
    const keys = Object.keys(candidate);
    if (keys.length !== payloadKeys.length || payloadKeys.some((key) => !Object.hasOwn(candidate, key))) return undefined;
    if (typeof candidate.alertId !== "string" || !alertIdPattern.test(candidate.alertId)) return undefined;
    if (!isSafeSingleLineText(candidate.event) || !isSafeSingleLineText(candidate.assetRef) || !isSafeSingleLineText(candidate.site)) return undefined;
    if (candidate.severity !== "info" && candidate.severity !== "warning" && candidate.severity !== "critical") return undefined;
    if (!isSafeSingleLineText(candidate.dueDate) || (candidate.dueDate !== WHATSAPP_NOT_APPLICABLE && !isCalendarDate(candidate.dueDate))) return undefined;
    return {
      alertId: candidate.alertId,
      event: candidate.event,
      assetRef: candidate.assetRef,
      site: candidate.site,
      severity: candidate.severity,
      dueDate: candidate.dueDate,
    };
  } catch {
    return undefined;
  }
}

function pruneReplayCache(now: number): void {
  for (const [key, value] of replayCache) if (value.expiresAt <= now) replayCache.delete(key);
}

function getCachedResponse(alertId: string, now: number): CachedResponse | undefined {
  pruneReplayCache(now);
  return replayCache.get(alertId);
}

function cacheResponse(alertId: string, now: number, status: number, body: Record<string, unknown>): void {
  pruneReplayCache(now);
  while (replayCache.size >= WHATSAPP_REPLAY_MAX) {
    const first = replayCache.keys().next().value;
    if (first === undefined) break;
    replayCache.delete(first);
  }
  replayCache.set(alertId, { expiresAt: now + WHATSAPP_REPLAY_TTL_MS, status, body });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function sendToMeta(config: WhatsAppConfig, to: string, payload: WhatsAppAlertPayload, fetchImpl: WhatsAppFetch): Promise<ProviderResult> {
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: config.templateName,
      language: { code: config.templateLanguage },
      components: [{
        type: "body",
        parameters: [payload.event, payload.assetRef, payload.site, payload.severity, payload.dueDate].map((text) => ({ type: "text", text })),
      }],
    },
  };
  let response: Response;
  try {
    response = await fetchImpl(`${META_GRAPH_API_BASE_URL}/${config.graphApiVersion}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { kind: "ambiguous" };
  }

  if (response.status >= 400 && response.status < 500) return { kind: "rejected" };
  if (response.status !== 200) return { kind: "ambiguous" };

  let text: string;
  try {
    text = await response.text();
  } catch {
    return { kind: "ambiguous" };
  }
  if (text.length > 16_384) return { kind: "ambiguous" };
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || value.messaging_product !== "whatsapp" || !Array.isArray(value.messages) || value.messages.length < 1) return { kind: "ambiguous" };
    const message = value.messages[0];
    if (!isRecord(message) || typeof message.id !== "string" || !wamidPattern.test(message.id)) return { kind: "ambiguous" };
    if (message.message_status !== undefined && !["accepted", "held_for_quality_assessment", "paused"].includes(message.message_status as string)) return { kind: "ambiguous" };
    return { kind: "accepted" };
  } catch {
    return { kind: "ambiguous" };
  }
}

export async function handleWhatsAppGet(env: Environment = process.env, fetchImpl: WhatsAppFetch = globalThis.fetch): Promise<Response> {
  const { config, tokenSource } = await resolveWhatsAppConfig(env, fetchImpl);
  return json({
    configured: Boolean(config),
    provider: "Meta",
    webhookConfigured: isWhatsAppWebhookConfigValid(env),
    tokenUpdatable: isTokenUpdatable(env),
    ...(config ? {
      recipientLabel: `WhatsApp ending in ${config.to.map((value) => `•••• ${value.slice(-4)}`).join(", ")}`,
      templateName: config.templateName,
      templateLanguage: config.templateLanguage,
      tokenSource,
    } : {}),
  });
}

export async function handleWhatsAppPost(request: Request, options: HandlerOptions = {}): Promise<Response> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const { config } = await resolveWhatsAppConfig(env, fetchImpl);
  if (!config) return json({ error: "WhatsApp Cloud API is not configured." }, 503);
  if (!sameOrigin(request)) return json({ error: "Same-origin request required." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return json({ error: "Content-Type must be application/json." }, 415);
  const now = options.now?.() ?? Date.now();

  let text: string;
  try {
    text = await readBoundedBody(request);
  } catch (error) {
    return json({ error: error instanceof Error && error.message === "too-large" ? "Request is too large." : "Request body could not be read." }, 413);
  }
  const payload = parseAlertPayload(text);
  if (!payload) return json({ error: "Request contains invalid alert details." }, 400);

  const cached = getCachedResponse(payload.alertId, now);
  if (cached) return json(cached.body, cached.status);
  if (inFlight) return json({ error: "Another WhatsApp alert request is in progress." }, 429);
  if (lastAttemptAt !== undefined && now - lastAttemptAt < WHATSAPP_COOLDOWN_MS) return json({ error: "Please wait before sending another WhatsApp alert." }, 429);

  lastAttemptAt = now;
  inFlight = true;
  try {
    // A partial send counts as unconfirmed, so a retry can't message the numbers that already got it twice.
    const kinds = new Set((await Promise.all(config.to.map((to) => sendToMeta(config, to, payload, fetchImpl)))).map((result) => result.kind));
    const result = kinds.size === 1 ? [...kinds][0] : "ambiguous";
    if (result === "accepted") {
      const body = { accepted: true, status: "accepted" };
      cacheResponse(payload.alertId, now, 200, body);
      return json(body);
    }
    if (result === "ambiguous") {
      const body = { error: "WhatsApp status is unconfirmed. Check Meta before retrying." };
      cacheResponse(payload.alertId, now, 503, body);
      return json(body, 503);
    }
    return json({ error: "Meta rejected the WhatsApp message request; no acceptance was returned." }, 502);
  } finally {
    inFlight = false;
  }
}

// Public by design: anyone can submit, but a token is saved only after Meta confirms it can use the
// configured phone number, so only someone who already controls that number can change it.
export async function handleWhatsAppTokenPost(request: Request, options: HandlerOptions = {}): Promise<Response> {
  const env = options.env ?? process.env;
  const store = getTokenStore(env);
  const phoneNumberId = rawValue(env, "META_WHATSAPP_PHONE_NUMBER_ID");
  const graphApiVersion = optionalValue(env, "META_GRAPH_API_VERSION", DEFAULT_GRAPH_API_VERSION);
  if (!store || !phoneNumberId || !phoneNumberIdPattern.test(phoneNumberId) || !graphApiVersionPattern.test(graphApiVersion)) return json({ error: "Token updates are not configured." }, 503);
  if (!sameOrigin(request)) return json({ error: "Same-origin request required." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return json({ error: "Content-Type must be application/json." }, 415);
  const now = options.now?.() ?? Date.now();
  if (lastTokenAttemptAt !== undefined && now - lastTokenAttemptAt < WHATSAPP_COOLDOWN_MS) return json({ error: "Please wait a few seconds before trying again." }, 429);
  lastTokenAttemptAt = now;

  let token: unknown;
  try {
    const value: unknown = JSON.parse(await readBoundedBody(request));
    token = isRecord(value) && Object.keys(value).length === 1 ? value.token : undefined;
  } catch {
    return json({ error: "Request could not be read." }, 400);
  }
  const accessToken = typeof token === "string" ? token.trim() : "";
  if (!accessTokenPattern.test(accessToken)) return json({ error: "Paste a Meta access token. It starts with EAA." }, 400);

  const fetchImpl = options.fetch ?? globalThis.fetch;
  try {
    const response = await fetchImpl(`${META_GRAPH_API_BASE_URL}/${graphApiVersion}/${phoneNumberId}?fields=id`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const value: unknown = response.ok ? await response.json() : undefined;
    if (!isRecord(value) || value.id !== phoneNumberId) return json({ error: "Meta did not accept this token for the KTrack WhatsApp number." }, 400);
  } catch {
    return json({ error: "Meta could not be reached. Try again." }, 503);
  }
  try {
    if (await storeCommand(store, ["SET", TOKEN_STORE_KEY, accessToken], fetchImpl) !== "OK") throw new Error("token-store");
  } catch {
    return json({ error: "The token could not be saved. Try again." }, 503);
  }
  return json({ saved: true });
}
