import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sessionUser } from "@/lib/auth";
import { IS_TRIAL } from "@/lib/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The customers that have a login, for the new tally sheet's Customer list. A customer account sees a job only when the
// job's Customer is its own, so staff pick the name from here instead of typing it.
export async function GET(request: Request) {
  if (!IS_TRIAL) return new Response(null, { status: 404 });
  const user = await sessionUser(request);
  if (!user) return NextResponse.json({ error: "Sign in again to load customers." }, { status: 401 });
  if (user.role === "Customer") return NextResponse.json({ error: "Only AMS staff see the customer list." }, { status: 403 });
  const { results } = await getCloudflareContext().env.DB.prepare(`SELECT DISTINCT customer FROM "user" WHERE role = 'Customer' AND trim(coalesce(customer, '')) != ''`).all<{ customer: string }>();
  return NextResponse.json({ customers: results.map((row) => row.customer) }, { headers: { "Cache-Control": "no-store" } });
}
