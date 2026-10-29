import { setLiveStatus } from "@/lib/tokens";

export const runtime = "nodejs";

export const POST = (request: Request) => setLiveStatus(request);
