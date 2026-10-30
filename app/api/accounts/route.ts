import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { adminOnly, getAuth } from "@/lib/auth";
import { readablePassword } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Everyone who can sign in, staff first, for the Admin's Accounts page.
export async function GET(request: Request) {
  const admin = await adminOnly(request);
  if (admin instanceof Response) return admin;
  const { results } = await getCloudflareContext().env.DB.prepare(`SELECT id, name, email, role, customer FROM "user" ORDER BY role = 'Customer', name`).all();
  return NextResponse.json({ accounts: results }, { headers: { "Cache-Control": "no-store" } });
}

// A customer's login, with a new password the Admin sees once and passes on, since KTrack sends no email. Staff accounts
// still come from scripts/trial-accounts.ts.
export async function POST(request: Request) {
  const admin = await adminOnly(request);
  if (admin instanceof Response) return admin;
  const body = await request.json().catch(() => null) as { name?: unknown; email?: unknown; customer?: unknown } | null;
  const text = (value: unknown) => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  const name = text(body?.name), email = text(body?.email).toLowerCase(), customer = text(body?.customer);
  if (!name || !customer || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Give the person's name, their email and their company." }, { status: 400 });
  const context = await getAuth().$context;
  if (await context.internalAdapter.findUserByEmail(email)) return NextResponse.json({ error: `${email} already has a login. Give it a new password instead.` }, { status: 409 });
  const password = readablePassword();
  const user = await context.internalAdapter.createUser({ name, email, emailVerified: true, role: "Customer", customer }, { method: "admin" });
  await context.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: await context.password.hash(password) });
  return NextResponse.json({ account: { id: user.id, name, email, role: "Customer", customer }, password }, { headers: { "Cache-Control": "no-store" } });
}
