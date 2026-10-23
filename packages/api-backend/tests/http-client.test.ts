// SPDX-License-Identifier: BUSL-1.1

import { test } from "node:test";
import assert from "node:assert/strict";
import { ThrottledHttpClient, RateLimitedError, HttpStatusError } from "../src/http-client.ts";
import { newDeviceIds, type FingerprintConfig } from "../src/fingerprint.ts";
import { startTestServer, type Handler } from "./support.ts";

const FP: FingerprintConfig = {
  appSlug: "TestApp",
  appVersion: "1.0.0",
  buildNumber: "100",
  cfNetworkVersion: "3859.100.1",
  darwinVersion: "25.0.0",
  deviceModelCode: "iPhone15,2",
  devicePlatform: "iOS",
  osVersion: "26.0",
  locale: { language: "en-US", region: "US" },
};

test("minimum interval between requests is enforced", async () => {
  const server = await startTestServer(() => ({ status: 200, body: { ok: true } }));
  try {
    const client = new ThrottledHttpClient(server.url, FP, newDeviceIds(), { minIntervalMs: 250, logger: () => {} });
    const t0 = Date.now();
    await Promise.all([client.request("/a"), client.request("/b"), client.request("/c")]);
    const elapsed = Date.now() - t0;
    assert.ok(elapsed >= 500, `expected >=500ms for 3 serialized requests, got ${elapsed}ms`);
  } finally {
    await server.close();
  }
});

test("429 is retried with backoff, honoring Retry-After, then succeeds", async () => {
  let calls = 0;
  const handler: Handler = () => {
    calls += 1;
    if (calls <= 2) return { status: 429, body: { error: "slow down" }, headers: { "retry-after": "1" } };
    return { status: 200, body: { ok: true } };
  };
  const server = await startTestServer(handler);
  try {
    const lines: string[] = [];
    const client = new ThrottledHttpClient(server.url, FP, newDeviceIds(), {
      minIntervalMs: 0,
      baseBackoffMs: 50,
      maxBackoffMs: 10000, // high cap so the 1s Retry-After is honored, not capped
      logger: (l) => lines.push(l),
    });
    const t0 = Date.now();
    const res = await client.request("/x");
    const elapsed = Date.now() - t0;
    assert.equal(res.status, 200);
    assert.equal(res.attempts, 3);
    assert.ok(res.retried);
    // Two Retry-After: 1s sleeps must be visible in elapsed time.
    assert.ok(elapsed >= 1900, `Retry-After should force ~2s of waiting, got ${elapsed}ms`);
    // Log lines carry status/backoff but no secrets.
    assert.ok(lines.some((l) => l.includes("status=429")));
  } finally {
    await server.close();
  }
});

test("persistent 429 exhausts the retry budget and raises RateLimitedError", async () => {
  const server = await startTestServer(() => ({ status: 429, body: { error: "slow down" } }));
  try {
    const client = new ThrottledHttpClient(server.url, FP, newDeviceIds(), {
      minIntervalMs: 0,
      maxRetries: 2,
      baseBackoffMs: 10,
      maxBackoffMs: 50,
      logger: () => {},
    });
    await assert.rejects(() => client.request("/x"), RateLimitedError);
    assert.equal(server.requests.length, 3); // 1 initial + 2 retries
  } finally {
    await server.close();
  }
});

test("non-retryable 4xx (e.g. 403) is NOT retried and raises HttpStatusError", async () => {
  const server = await startTestServer(() => ({ status: 403, body: { error: "forbidden" } }));
  try {
    const client = new ThrottledHttpClient(server.url, FP, newDeviceIds(), { minIntervalMs: 0, logger: () => {} });
    await assert.rejects(() => client.request("/x"), (err: unknown) => {
      assert.ok(err instanceof HttpStatusError);
      assert.equal((err as HttpStatusError).status, 403);
      return true;
    });
    assert.equal(server.requests.length, 1);
  } finally {
    await server.close();
  }
});

test("three consecutive failures mark the backend DEGRADED", async () => {
  const server = await startTestServer(() => ({ status: 500, body: { error: "boom" } }));
  try {
    const client = new ThrottledHttpClient(server.url, FP, newDeviceIds(), {
      minIntervalMs: 0,
      maxRetries: 0,
      logger: () => {},
    });
    assert.equal(client.health().degraded, false);
    for (let i = 0; i < 3; i++) {
      // 500 with zero retries: budget exhausted immediately -> RateLimitedError.
      await assert.rejects(() => client.request("/x"), RateLimitedError);
    }
    assert.equal(client.health().degraded, true);
    assert.equal(client.health().consecutiveFailures, 3);
    client.resetHealth();
    assert.equal(client.health().degraded, false);
  } finally {
    await server.close();
  }
});

test("auth token never appears in log output", async () => {
  const server = await startTestServer(() => ({ status: 200, body: { ok: true } }));
  try {
    const lines: string[] = [];
    const client = new ThrottledHttpClient(server.url, FP, newDeviceIds(), { minIntervalMs: 0, logger: (l) => lines.push(l) });
    await client.request("/secure", { authToken: "top-secret-token-abc123" });
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.ok(!line.includes("top-secret-token-abc123"), `secret leaked in log: ${line}`);
    }
  } finally {
    await server.close();
  }
});

test("simulated timeout: hanging server aborts at requestTimeoutMs (no infinite wait)", async () => {
  const { createServer } = await import("node:http");
  const hanging = createServer(() => {
    /* never respond */
  });
  await new Promise<void>((resolve) => hanging.listen(0, "127.0.0.1", resolve));
  const addr = hanging.address();
  if (!addr || typeof addr === "string") throw new Error("hanging server failed to bind");
  try {
    const client = new ThrottledHttpClient(`http://127.0.0.1:${addr.port}`, FP, newDeviceIds(), {
      minIntervalMs: 0,
      requestTimeoutMs: 150,
      maxRetries: 0,
      logger: () => {},
    });
    await assert.rejects(() => client.request("/hang"), /abort/i);
  } finally {
    hanging.close();
  }
});

test("empty 200 body parses as null (empty response is data, not an error)", async () => {
  const { createServer } = await import("node:http");
  const empty = createServer((_req, res) => {
    res.writeHead(200);
    res.end();
  });
  await new Promise<void>((resolve) => empty.listen(0, "127.0.0.1", resolve));
  const addr = empty.address();
  if (!addr || typeof addr === "string") throw new Error("empty server failed to bind");
  try {
    const client = new ThrottledHttpClient(`http://127.0.0.1:${addr.port}`, FP, newDeviceIds(), {
      minIntervalMs: 0,
      logger: () => {},
    });
    const res = await client.request("/empty");
    assert.equal(res.status, 200);
    assert.equal(res.data, null);
  } finally {
    empty.close();
  }
});

test("impersonation headers reach the server on every request", async () => {
  const server = await startTestServer(() => ({ status: 200, body: { ok: true } }));
  try {
    const ids = newDeviceIds();
    const client = new ThrottledHttpClient(server.url, FP, ids, { minIntervalMs: 0, logger: () => {} });
    await client.request("/x", { authToken: "tok" });
    const headers = server.requests[0].headers;
    assert.match(String(headers["user-agent"]), /TestApp\/100 CFNetwork\//);
    assert.equal(headers["x-device-id"], ids.deviceId);
    assert.equal(headers["authorization"], "Bearer tok");
    assert.equal(headers["x-device-region"], "US");
  } finally {
    await server.close();
  }
});
