import { NextResponse } from "next/server";
import { verifyLiveToken } from "@/lib/tokens";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });
  const result = await verifyLiveToken(token, process.env.DEMO_CERT_TOKEN_SECRET ?? "");
  return result.ok ? NextResponse.json(result, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json(result, { status: 401, headers: { "Cache-Control": "no-store" } });
}
