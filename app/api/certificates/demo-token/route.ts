import { NextResponse } from "next/server";
import { isDateString } from "@/lib/domain";
import { uuidPattern } from "@/lib/field";
import { createDemoToken, statusIdFor } from "@/lib/tokens";

export const runtime = "nodejs";

const statuses = new Set(["Valid", "Expired", "Revoked", "Superseded"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isSafeText(value: unknown, max = 160): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[<>\u0000-\u001f]/.test(value);
}

export async function POST(request: Request) {
  const secret = process.env.DEMO_CERT_TOKEN_SECRET;
  if (!secret || secret.length < 32) return NextResponse.json({ error: "DEMO_CERT_TOKEN_SECRET is missing or too short" }, { status: 503 });
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
    || (candidate.statusKey !== undefined && (typeof candidate.statusKey !== "string" || !uuidPattern.test(candidate.statusKey)))) return NextResponse.json({ error: "Snapshot contains invalid fields" }, { status: 400 });
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  let origin: string;
  try { const url = new URL(configuredUrl || request.url); if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol"); origin = url.origin; } catch { return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL is invalid" }, { status: 500 }); }
  const snapshot = { certificateNo: candidate.certificateNo as string, assetRef: candidate.assetRef as string, assetType: candidate.assetType as string, issuedDate: candidate.issuedDate as string, expiryDate: candidate.expiryDate as string, status: candidate.status as "Valid" | "Expired" | "Revoked" | "Superseded", asOf: new Date().toISOString(), ...(candidate.kind === "warranty" ? { kind: "warranty" as const } : {}), ...(typeof candidate.statusKey === "string" ? { statusId: statusIdFor(candidate.statusKey, secret) } : {}) };
  const token = createDemoToken(snapshot, secret);
  return NextResponse.json({ token, verifyUrl: `${origin}/verify?token=${encodeURIComponent(token)}` }, { headers: { "Cache-Control": "no-store" } });
}
