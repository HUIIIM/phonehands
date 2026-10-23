// SPDX-License-Identifier: BUSL-1.1

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HingeApiAdapter } from "../src/hinge-adapter.ts";
import { startMockHingeServer, type MockHingeServer } from "../src/mock-server.ts";
import { WriteNotEnabledError } from "../src/write-tools.ts";

let server: MockHingeServer;

before(async () => {
  server = await startMockHingeServer();
  // REDLINE GUARD: the adapter under test must only ever talk to the mock.
  assert.ok(server.url.startsWith("http://127.0.0.1"), `mock must bind loopback, got ${server.url}`);
});

after(async () => {
  await server.close();
});

function makeAdapter() {
  const dir = mkdtempSync(join(tmpdir(), "phonehands-hinge-test-"));
  return new HingeApiAdapter({
    baseUrl: server.url,
    locale: { language: "en-US", region: "US" },
    sessionDir: dir,
    throttle: { minIntervalMs: 0, baseBackoffMs: 10, maxBackoffMs: 50, maxRetries: 2, logger: () => {} },
    logger: () => {},
  });
}

/** Log in through the mock's known test OTP (mock-only, never a real secret). */
async function loginMock(adapter: HingeApiAdapter) {
  await adapter.auth.install();
  await adapter.auth.initiate("+10000000000");
  await adapter.auth.submitOtp("+10000000000", "000000");
}

test("likes_received returns structured JSON in the core envelope", async () => {
  const adapter = makeAdapter();
  await loginMock(adapter);
  const res = await adapter.likesReceived({ limit: 5 });
  assert.equal(res.ok, true);
  assert.equal(res.backend, "api");
  assert.equal(res.degraded, false);
  assert.ok(res.latency_ms >= 0);
  assert.ok(res.evidence);
  assert.equal(res.evidence.items.length, 5);
  assert.equal(res.evidence.nextCursor, "5");
  const first = res.evidence.items[0];
  assert.equal(first.id, "like-1");
  assert.ok(first.name.length > 0);
  assert.ok(Array.isArray(first.photoUrls));
});

test("matches paginates across the full 20-item fixture", async () => {
  const adapter = makeAdapter();
  await loginMock(adapter);
  const page1 = await adapter.matches({ limit: 7 });
  assert.equal(page1.ok, true);
  assert.equal(page1.evidence?.items.length, 7);
  assert.ok(page1.evidence?.nextCursor);
  const page2 = await adapter.matches({ limit: 7, cursor: page1.evidence?.nextCursor ?? undefined });
  assert.equal(page2.evidence?.items.length, 7);
  assert.notEqual(page2.evidence?.items[0].id, page1.evidence?.items[0].id);
  const page3 = await adapter.matches({ limit: 7, cursor: page2.evidence?.nextCursor ?? undefined });
  assert.equal(page3.evidence?.items.length, 6);
  assert.equal(page3.evidence?.nextCursor, null);
  const first = page1.evidence?.items[0];
  assert.ok(first?.chatId.startsWith("chat-"));
});

test("chat_messages returns the conversation for a chat", async () => {
  const adapter = makeAdapter();
  await loginMock(adapter);
  const res = await adapter.chatMessages("chat-3", { limit: 10 });
  assert.equal(res.ok, true);
  assert.equal(res.evidence?.items.length, 6);
  for (const m of res.evidence?.items ?? []) {
    assert.equal(m.chatId, "chat-3");
    assert.ok(m.sender === "me" || m.sender === "them");
    assert.ok(m.body.length > 0);
  }
});

test("read() dispatches all three kinds (core read semantics)", async () => {
  const adapter = makeAdapter();
  await loginMock(adapter);
  const likes = await adapter.read("likes_received", { limit: 2 });
  assert.equal(likes.ok, true);
  assert.equal(likes.evidence?.items.length, 2);
  const matches = await adapter.read("matches", { limit: 2 });
  assert.equal(matches.ok, true);
  const msgs = await adapter.read("chat_messages", { chatId: "chat-1", limit: 2 });
  assert.equal(msgs.ok, true);
  await assert.rejects(() => adapter.read("chat_messages", { limit: 2 }), /chatId/);
  await assert.rejects(() => adapter.read("tap" as never), /not supported/);
});

test("reads without login return a NOT_LOGGED_IN envelope (no silent failure)", async () => {
  const adapter = makeAdapter();
  const res = await adapter.likesReceived();
  assert.equal(res.ok, false);
  assert.equal(res.evidence, null);
  assert.equal(res.error?.code, "NOT_LOGGED_IN");
});

test("simulated 403 -> ok:false envelope with HTTP_403 code (no retry)", async () => {
  const adapter = makeAdapter();
  await loginMock(adapter);
  const before = server.requests.length;
  const res = await adapter.likesReceived({ fault: "403" });
  assert.equal(res.ok, false);
  assert.equal(res.degraded, true);
  assert.equal(res.error?.code, "HTTP_403");
  assert.equal(server.requests.length, before + 1); // not retried
});

test("three consecutive failures mark the backend degraded in the envelope", async () => {
  const adapter = makeAdapter();
  await loginMock(adapter);
  for (let i = 0; i < 3; i++) {
    await adapter.likesReceived({ fault: "403" });
  }
  const res = await adapter.likesReceived({ fault: "403" });
  assert.equal(res.degraded, true);
});

test("persistent 429 exhausts retries -> ok:false, degraded:true", async () => {
  const adapter = makeAdapter();
  await loginMock(adapter);
  const res = await adapter.likesReceived({ fault: "429" });
  assert.equal(res.ok, false);
  assert.equal(res.degraded, true);
});

test("empty response is data, not an error: ok:true with zero items", async () => {
  const adapter = makeAdapter();
  await loginMock(adapter);
  const res = await adapter.likesReceived({ fault: "empty" });
  assert.equal(res.ok, true);
  assert.equal(res.degraded, false);
  assert.deepEqual(res.evidence?.items, []);
  assert.equal(res.evidence?.nextCursor, null);
});

test("writes are refused by default (compile-time read-only + allowlist)", async () => {
  const adapter = makeAdapter();
  assert.throws(() => adapter.attemptWrite("send_message"), WriteNotEnabledError);
});

test("writes stay refused even when the env allowlist names them (Phase 1: registry empty)", async () => {
  const adapter = makeAdapter();
  process.env["HINGE_ALLOWED_WRITE_TOOLS"] = "send_message";
  try {
    // Nothing is implemented, so the tool is unknown -> default deny still holds.
    assert.throws(() => adapter.attemptWrite("send_message"), WriteNotEnabledError);
  } finally {
    delete process.env["HINGE_ALLOWED_WRITE_TOOLS"];
  }
});

test("adapter requires an explicit baseUrl (no silent production default)", () => {
  assert.throws(
    () =>
      new HingeApiAdapter({
        baseUrl: "",
        locale: { language: "en-US", region: "US" },
      }),
    /explicit baseUrl/,
  );
});

test("locale is required (parameterized, never hardcoded)", () => {
  assert.throws(
    () =>
      new HingeApiAdapter({
        baseUrl: server.url,
        locale: { language: "", region: "" },
      }),
    /locale/i,
  );
});
