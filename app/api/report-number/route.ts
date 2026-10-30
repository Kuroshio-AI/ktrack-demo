import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sessionUser } from "@/lib/auth";
import { IS_TRIAL } from "@/lib/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The next report's sequence number, so no two laptops issue the same one. A number taken for an approval that then
// doesn't happen is skipped, never handed out again.
export async function POST(request: Request) {
  if (!IS_TRIAL) return new Response(null, { status: 404 });
  const user = await sessionUser(request);
  if (!user) return NextResponse.json({ error: "Sign in again to issue a report." }, { status: 401 });
  if (user.role !== "Admin" && user.role !== "Reviewer") return NextResponse.json({ error: "Only a Reviewer or Admin issues reports." }, { status: 403 });
  const row = await getCloudflareContext().env.DB.prepare("UPDATE counter SET value = value + 1 WHERE name = 'report' RETURNING value").first<{ value: number }>();
  if (!row) return NextResponse.json({ error: "Report numbering isn't set up on the server." }, { status: 500 });
  return NextResponse.json({ sequence: row.value }, { headers: { "Cache-Control": "no-store" } });
}
