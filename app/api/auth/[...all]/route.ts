import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
import { IS_TRIAL } from "@/lib/client";

export const runtime = "nodejs";

// Only the Cloudflare trial has accounts; the Vercel demos answer 404.
const handler = (method: "GET" | "POST") => (request: Request) => IS_TRIAL ? toNextJsHandler(getAuth())[method](request) : new Response(null, { status: 404 });
export const GET = handler("GET");
export const POST = handler("POST");
