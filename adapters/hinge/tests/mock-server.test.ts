// SPDX-License-Identifier: BUSL-1.1

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMockHingeServer, type MockHingeServer } from "../src/mock-server.ts";

let server: MockHingeServer;

before(async () => {
  server = await startMockHingeServer();
});

after(async () => {
  await server.close();
});

async function post(path: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${server.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

test("mock binds loopback only (test redline)", () => {
  assert.ok(server.url.startsWith("http://127.0.0.1"));
});

test("unauthenticated reads are rejected with 401", async () => {
  const res = await fetch(`${server.url}/likes/received`);
  assert.equal(res.status, 401);
});

test("mock login flow issues a bearer token that unlocks reads", async () => {
  const install = await post("/identity/install", { installId: "x" });
  assert.equal(install.status, 200);
  const initiate = await post("/auth/sms/v2/initiate", { deviceId: "x", phoneNumber: "+1" });
  assert.equal(initiate.status, 200);
  const bad = await post("/auth/sms/v2", { otp: "nope" });
  assert.equal(bad.status, 401);
  const good = await post("/auth/sms/v2", { otp: "000000" });
  assert.equal(good.status, 200);
  const token = (good.data as Record<string, string>)["authToken"];
  assert.ok(token.startsWith("mock-token-"));

  const likes = await fetch(`${server.url}/likes/received?limit=3`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(likes.status, 200);
  const payload = (await likes.json()) as { likes: unknown[]; nextCursor: string | null };
  assert.equal(payload.likes.length, 3);
});

test("mock 412 path carries email-challenge context", async () => {
  const res = await post("/auth/sms/v2", { otp: "999999" });
  assert.equal(res.status, 412);
  const data = res.data as Record<string, string>;
  assert.equal(data["caseId"], "mock-case-1");
  assert.ok(data["email"].includes("@"));
});

test("mock fault injection: __fault=403 and __fault=429", async () => {
  const good = await post("/auth/sms/v2", { otp: "000000" });
  const token = (good.data as Record<string, string>)["authToken"];
  const headers = { authorization: `Bearer ${token}` };

  const f403 = await fetch(`${server.url}/matches?__fault=403`, { headers });
  assert.equal(f403.status, 403);

  const f429 = await fetch(`${server.url}/matches?__fault=429`, { headers });
  assert.equal(f429.status, 429);
  assert.equal(f429.headers.get("retry-after"), "1");
});
