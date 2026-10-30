import { NextResponse } from "next/server";
import { adminOnly, getAuth } from "@/lib/auth";
import { readablePassword } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// A new password for anyone but the Admin asking, shown once. It also signs them out everywhere, so the old password and
// any laptop left signed in stop working.
export async function POST(request: Request, { params }: Params) {
  const admin = await adminOnly(request);
  if (admin instanceof Response) return admin;
  const { id } = await params;
  if (id === admin.id) return NextResponse.json({ error: "Ask Kuroshio to change your own password." }, { status: 400 });
  const context = await getAuth().$context;
  if (!await context.internalAdapter.findUserById(id)) return NextResponse.json({ error: "That account no longer exists." }, { status: 404 });
  const password = readablePassword();
  await context.internalAdapter.updatePassword(id, await context.password.hash(password));
  await context.internalAdapter.deleteUserSessions(id);
  return NextResponse.json({ password }, { headers: { "Cache-Control": "no-store" } });
}

// Removes a customer's login; their jobs and reports stay. A staff account isn't removed here, since its name is on the
// sheets it signed: give it a new password instead.
export async function DELETE(request: Request, { params }: Params) {
  const admin = await adminOnly(request);
  if (admin instanceof Response) return admin;
  const { id } = await params;
  const context = await getAuth().$context;
  const user = await context.internalAdapter.findUserById(id) as { role?: string } | null;
  if (!user) return NextResponse.json({ error: "That account no longer exists." }, { status: 404 });
  if (user.role !== "Customer") return NextResponse.json({ error: "Only a customer's login is removed here." }, { status: 400 });
  await context.internalAdapter.deleteUserSessions(id);
  await context.internalAdapter.deleteAccounts(id);
  await context.internalAdapter.deleteUser(id);
  return new Response(null, { status: 204 });
}
