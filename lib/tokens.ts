import { createHmac, timingSafeEqual } from "node:crypto";
import { fieldStore, redis, sameOrigin, uuidPattern } from "@/lib/field";

export const TOKEN_TTL_SECONDS = 24 * 60 * 60;

export type DemoTokenSnapshot = {
  certificateNo: string;
  assetRef: string;
  assetType: string;
  issuedDate: string;
  expiryDate: string;
  status: "Valid" | "Expired" | "Revoked" | "Superseded";
  asOf: string;
  kind?: "warranty";
  // Names the certificate's live status in Redis, so a QR printed before a revoke shows the revoke.
  statusId?: string;
  exp: number;
};

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function sign(value: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(value).digest());
}

export function createDemoToken(snapshot: Omit<DemoTokenSnapshot, "exp">, secret: string, now = Date.now()): string {
  if (secret.length < 32) throw new Error("DEMO_CERT_TOKEN_SECRET must be at least 32 characters");
  const payload: DemoTokenSnapshot = { ...snapshot, exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

function isSnapshot(value: unknown): value is DemoTokenSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DemoTokenSnapshot>;
  return [candidate.certificateNo, candidate.assetRef, candidate.assetType, candidate.issuedDate, candidate.expiryDate, candidate.status, candidate.asOf].every((item) => typeof item === "string")
    && ["Valid", "Expired", "Revoked", "Superseded"].includes(candidate.status as string)
    && (candidate.kind === undefined || candidate.kind === "warranty")
    && (candidate.statusId === undefined || typeof candidate.statusId === "string")
    && typeof candidate.exp === "number" && Number.isSafeInteger(candidate.exp);
}

export function verifyDemoToken(token: string, secret: string, now = Date.now()): { ok: true; snapshot: DemoTokenSnapshot } | { ok: false; error: string } {
  if (secret.length < 32) return { ok: false, error: "Token verification is not configured" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, error: "Invalid token" };
  const [encoded, provided] = parts;
  if (!encoded || !provided || token.length > 4096) return { ok: false, error: "Invalid token" };
  const expected = sign(encoded, secret);
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return { ok: false, error: "Invalid token signature" };
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); }
  catch { return { ok: false, error: "Invalid token payload" }; }
  if (!isSnapshot(parsed)) return { ok: false, error: "Invalid token payload" };
  if (parsed.exp <= Math.floor(now / 1000)) return { ok: false, error: "This token has expired" };
  return { ok: true, snapshot: parsed };
}

// The browser keeps a random status key per certificate and only ever sends it here; the token carries this HMAC of it,
// so a scanned QR names the status without giving anyone the key to change it.
export const statusIdFor = (statusKey: string, secret: string): string => sign(`status:${statusKey}`, secret);
const liveKey = (statusId: string) => `cert-status:${statusId}`;
const finalStatuses = ["Revoked", "Superseded"];

// A token lives 24 hours, so a status kept that long after the change covers every QR printed before it.
export async function setLiveStatus(request: Request, env: Record<string, string | undefined> = process.env): Promise<Response> {
  const secret = env.DEMO_CERT_TOKEN_SECRET ?? "";
  const store = fieldStore(env);
  if (secret.length < 32 || !store) return Response.json({ error: "Live QR status is not configured" }, { status: 503 });
  if (!sameOrigin(request)) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const body: unknown = await request.json().catch(() => undefined);
  const { statusKey, status } = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof statusKey !== "string" || !uuidPattern.test(statusKey) || !finalStatuses.includes(status as string)) return Response.json({ error: "Invalid request" }, { status: 400 });
  try { await redis(store, ["SET", liveKey(statusIdFor(statusKey, secret)), status as string, "EX", String(TOKEN_TTL_SECONDS)]); }
  catch { return Response.json({ error: "Live QR status could not be saved" }, { status: 502 }); }
  return Response.json({ ok: true });
}

// checkedAt is set only when the live status was read; without Redis the page falls back to the signed snapshot.
export async function verifyLiveToken(token: string, secret: string, env: Record<string, string | undefined> = process.env, now = Date.now()): Promise<{ ok: true; snapshot: DemoTokenSnapshot; checkedAt?: string } | { ok: false; error: string }> {
  const result = verifyDemoToken(token, secret, now);
  const store = fieldStore(env);
  if (!result.ok || !result.snapshot.statusId || !store) return result;
  try {
    const live = await redis(store, ["GET", liveKey(result.snapshot.statusId)]);
    const status = finalStatuses.includes(live as string) ? live as DemoTokenSnapshot["status"] : result.snapshot.status;
    return { ok: true, snapshot: { ...result.snapshot, status }, checkedAt: new Date(now).toISOString() };
  } catch { return result; }
}
