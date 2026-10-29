import assert from "node:assert/strict";
import test from "node:test";
import { createDemoToken, setLiveStatus, statusIdFor, verifyDemoToken, verifyLiveToken } from "./tokens";

const secret = "demo-only-secret-with-at-least-32-chars";
const snapshot = { certificateNo: "CERT-1", assetRef: "HAR-001", assetType: "Harness", issuedDate: "2026-01-01", expiryDate: "2026-12-31", status: "Valid" as const, asOf: "2026-01-02T00:00:00.000Z" };

test("demo certificate tokens verify and reject tampering", () => {
  const token = createDemoToken(snapshot, secret, Date.parse("2026-01-02T00:00:00Z"));
  assert.equal(verifyDemoToken(token, secret, Date.parse("2026-01-02T01:00:00Z")).ok, true);
  const tampered = `${token.slice(0, -1)}x`;
  assert.equal(verifyDemoToken(tampered, secret).ok, false);
});

test("demo certificate tokens expire after their TTL", () => {
  const now = Date.parse("2026-01-02T00:00:00Z");
  const token = createDemoToken(snapshot, secret, now);
  assert.equal(verifyDemoToken(token, secret, now + 86_400_001).ok, false);
});

test("warranty tokens keep their kind and reject unknown kinds", () => {
  const now = Date.parse("2026-01-02T00:00:00Z");
  const verified = verifyDemoToken(createDemoToken({ ...snapshot, kind: "warranty" }, secret, now), secret, now);
  assert.equal(verified.ok && verified.snapshot.kind, "warranty");
  const forged = createDemoToken({ ...snapshot, kind: "other" } as unknown as typeof snapshot, secret, now);
  assert.equal(verifyDemoToken(forged, secret, now).ok, false);
});

// An in-memory stand-in for the Upstash REST API, which takes one Redis command as a JSON array.
function fakeRedis(fail = false) {
  const data = new Map<string, string>();
  const commands: string[][] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    if (fail) return new Response("down", { status: 500 });
    const command = JSON.parse(init.body as string) as string[];
    commands.push(command);
    if (command[0] === "SET") data.set(command[1], command[2]);
    return Response.json({ result: command[0] === "GET" ? data.get(command[1]) ?? null : "OK" });
  }) as typeof fetch;
  return commands;
}
const env = { DEMO_CERT_TOKEN_SECRET: secret, KV_REST_API_URL: "https://redis.example", KV_REST_API_TOKEN: "test" };
const statusKey = "6f1c2b9e-1d4a-4c3b-9e8f-0a1b2c3d4e5f";
const post = (body: unknown, origin = "https://ktrack.example") => new Request("https://ktrack.example/api/certificates/status", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });

test("a revoke reaches QR codes created before it", async () => {
  const realFetch = globalThis.fetch;
  try {
    const commands = fakeRedis();
    const token = createDemoToken({ ...snapshot, statusId: statusIdFor(statusKey, secret) }, secret);
    const before = await verifyLiveToken(token, secret, env);
    assert.equal(before.ok && before.snapshot.status, "Valid");
    assert.ok(before.ok && before.checkedAt);
    assert.equal((await setLiveStatus(post({ statusKey, status: "Revoked" }), env)).status, 200);
    assert.deepEqual(commands.at(-1)?.slice(2), ["Revoked", "EX", "86400"]);
    const after = await verifyLiveToken(token, secret, env);
    assert.equal(after.ok && after.snapshot.status, "Revoked");
    // The token shows only the HMAC, never the key that can change the status.
    assert.ok(!token.includes(statusKey) && !Buffer.from(token.split(".")[0], "base64url").toString().includes(statusKey));
  } finally { globalThis.fetch = realFetch; }
});

test("live status refuses bad requests and falls back to the snapshot when Redis is down", async () => {
  const realFetch = globalThis.fetch;
  try {
    fakeRedis();
    assert.equal((await setLiveStatus(post({ statusKey, status: "Revoked" }, "https://evil.example"), env)).status, 403);
    assert.equal((await setLiveStatus(post({ statusKey, status: "Valid" }), env)).status, 400);
    assert.equal((await setLiveStatus(post({ statusKey: "not-a-key", status: "Revoked" }), env)).status, 400);
    assert.equal((await setLiveStatus(post({ statusKey, status: "Revoked" }), { DEMO_CERT_TOKEN_SECRET: secret })).status, 503);
    fakeRedis(true);
    assert.equal((await setLiveStatus(post({ statusKey, status: "Revoked" }), env)).status, 502);
    const down = await verifyLiveToken(createDemoToken({ ...snapshot, statusId: statusIdFor(statusKey, secret) }, secret), secret, env);
    assert.equal(down.ok && down.snapshot.status, "Valid");
    assert.equal(down.ok && down.checkedAt, undefined);
  } finally { globalThis.fetch = realFetch; }
});
