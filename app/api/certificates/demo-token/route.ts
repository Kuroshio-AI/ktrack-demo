import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sessionUser } from "@/lib/auth";
import { IS_GEX, IS_TRIAL } from "@/lib/client";
import { isDateString } from "@/lib/domain";
import { uuidPattern } from "@/lib/field";
import { customerKey } from "@/lib/sync";
import { createDemoToken, isTokenSummary, statusIdFor, TRIAL_TOKEN_TTL_SECONDS } from "@/lib/tokens";

export const runtime = "nodejs";

const statuses = new Set(["Valid", "Expired", "Revoked", "Superseded"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isSafeText(value: unknown, max = 160): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[<>\u0000-\u001f]/.test(value);
}

export async function POST(request: Request) {
  const secret = process.env.DEMO_CERT_TOKEN_SECRET;
  if (!secret || secret.length < 32) return NextResponse.json({ error: "DEMO_CERT_TOKEN_SECRET is missing or too short" }, { status: 503 });
  // The demos make QR codes for anyone. On the trial a QR shows a real report to whoever scans it, so staff make one for
  // any report and a customer only for a report on their own jobs.
  let customer: string | undefined;
  if (IS_TRIAL) {
    const user = await sessionUser(request);
    if (!user) return NextResponse.json({ error: "Sign in again to create a QR code." }, { status: 401 });
    if (user.role === "Customer") customer = customerKey(user.customer) ?? "";
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  const text = await request.text();
  if (text.length > 8_192) return NextResponse.json({ error: "Request is too large" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const candidate = body as Record<string, unknown>;
  const fields = ["certificateNo", "assetRef", "assetType", "issuedDate", "expiryDate"];
  if (!fields.every((field) => isSafeText(candidate[field])) || !datePattern.test(candidate.issuedDate as string) || !datePattern.test(candidate.expiryDate as string) || !isDateString(candidate.issuedDate) || !isDateString(candidate.expiryDate) || candidate.expiryDate < candidate.issuedDate || !statuses.has(candidate.status as string)
    || (candidate.kind !== undefined && (candidate.kind !== "warranty" || !["Valid", "Expired", "Revoked"].includes(candidate.status as string)))
    || (candidate.statusKey !== undefined && (typeof candidate.statusKey !== "string" || !uuidPattern.test(candidate.statusKey)))
    || (candidate.summary !== undefined && (!IS_GEX || !isTokenSummary(candidate.summary)))) return NextResponse.json({ error: "Snapshot contains invalid fields" }, { status: 400 });
  if (customer !== undefined && !await getCloudflareContext().env.DB.prepare("SELECT 1 FROM item, json_each(item.data, '$.certificates') AS certificate WHERE item.kind = 'record' AND item.data IS NOT NULL AND item.customer = ? AND json_extract(certificate.value, '$.number') = ?").bind(customer, candidate.certificateNo).first())
    return NextResponse.json({ error: "This report isn't on your account." }, { status: 403 });
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  let origin: string;
  try { const url = new URL(configuredUrl || request.url); if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol"); origin = url.origin; } catch { return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL is invalid" }, { status: 500 }); }
  const snapshot = { certificateNo: candidate.certificateNo as string, assetRef: candidate.assetRef as string, assetType: candidate.assetType as string, issuedDate: candidate.issuedDate as string, expiryDate: candidate.expiryDate as string, status: candidate.status as "Valid" | "Expired" | "Revoked" | "Superseded", asOf: new Date().toISOString(), ...(candidate.kind === "warranty" ? { kind: "warranty" as const } : {}), ...(typeof candidate.statusKey === "string" ? { statusId: statusIdFor(candidate.statusKey, secret) } : {}), ...(candidate.summary !== undefined ? { summary: candidate.summary as [string, string][] } : {}) };
  const token = createDemoToken(snapshot, secret, Date.now(), IS_TRIAL || IS_GEX ? TRIAL_TOKEN_TTL_SECONDS : undefined);
  // Each field is capped, but multibyte text grows in base64; verifyDemoToken refuses anything longer, so never mint it.
  if (token.length > 4096) return NextResponse.json({ error: "Snapshot is too long for a QR code" }, { status: 400 });
  return NextResponse.json({ token, verifyUrl: `${origin}/verify?token=${encodeURIComponent(token)}` }, { headers: { "Cache-Control": "no-store" } });
}
