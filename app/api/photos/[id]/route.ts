import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sessionUser } from "@/lib/auth";
import { IS_TRIAL } from "@/lib/client";
import { customerKey } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tally sheet photos in R2, one object per photo id. Staff upload them from the outbox; anyone signed in reads them,
// except that a customer account reads only photos of its own tally sheets.
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 3 * 1024 * 1024;
const validId = (id: string) => /^photo-[\w-]{1,80}$/.test(id);
type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Context) {
  if (!IS_TRIAL) return new Response(null, { status: 404 });
  const user = await sessionUser(request);
  if (!user) return NextResponse.json({ error: "Sign in again to upload photos." }, { status: 401 });
  if (user.role === "Customer") return NextResponse.json({ error: "Customer accounts can't add photos." }, { status: 403 });
  const { id } = await params;
  const inspectionId = new URL(request.url).searchParams.get("inspection") ?? "";
  const type = request.headers.get("content-type") ?? "";
  if (!validId(id) || !inspectionId || inspectionId.length > 200 || !TYPES.has(type)) return NextResponse.json({ error: "Invalid photo" }, { status: 400 });
  const image = await request.arrayBuffer();
  if (!image.byteLength || image.byteLength > MAX_BYTES) return NextResponse.json({ error: "A photo must be under 3 MB." }, { status: 413 });
  await getCloudflareContext().env.PHOTOS.put(`photos/${id}`, image, { httpMetadata: { contentType: type }, customMetadata: { inspectionId, uploadedBy: user.name } });
  return new Response(null, { status: 204 });
}

export async function GET(request: Request, { params }: Context) {
  if (!IS_TRIAL) return new Response(null, { status: 404 });
  const user = await sessionUser(request);
  if (!user) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!validId(id)) return new Response(null, { status: 404 });
  const { env } = getCloudflareContext();
  const photo = await env.PHOTOS.get(`photos/${id}`);
  if (!photo) return new Response(null, { status: 404 });
  if (user.role === "Customer") {
    const sheet = await env.DB.prepare("SELECT customer FROM item WHERE kind = 'inspection' AND id = ?").bind(photo.customMetadata?.inspectionId ?? "").first<{ customer: string | null }>();
    if (!sheet?.customer || sheet.customer !== customerKey(user.customer)) return new Response(null, { status: 404 });
  }
  // A photo id never gets a different image, so the browser keeps it.
  return new Response(photo.body, { headers: { "Content-Type": photo.httpMetadata?.contentType ?? "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" } });
}
