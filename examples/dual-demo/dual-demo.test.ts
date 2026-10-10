// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)
//
// dual-demo tests — all mocks, no real network/device/account.
// Run: node --test dual-demo.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiBackend,
  DeviceBackend,
  MockHingeApiServer,
  MockWdaServer,
  Router,
  type AttemptLog,
  type ResultEnvelope,
  type Match,
} from "./dual-demo.ts";

interface Harness {
  apiServer: MockHingeApiServer;
  wda: MockWdaServer;
  router: Router;
  logs: AttemptLog[];
}

function makeHarness(): Harness {
  const apiServer = new MockHingeApiServer();
  const wda = new MockWdaServer();
  const logs: AttemptLog[] = [];
  // Fixed latencies so assertions are deterministic.
  const router = new Router(
    new ApiBackend(apiServer, { latencyMs: () => 50 }),
    new DeviceBackend(wda, { latencyMs: () => 400 }),
    (e) => logs.push(e),
    { degradeAfter4xx: 1 },
  );
  return { apiServer, wda, router, logs };
}

function assertEnvelopeShape(env: ResultEnvelope<Match[]>): void {
  assert.equal(typeof env.ok, "boolean");
  assert.ok(env.backend === "api" || env.backend === "device");
  assert.equal(typeof env.latency_ms, "number");
  assert.ok(env.latency_ms >= 0);
  assert.equal(typeof env.degraded, "boolean");
  assert.ok(Array.isArray(env.evidence));
}

test("healthy API: reads go through the api backend, not degraded", async () => {
  const { wda, router, logs } = makeHarness();

  const env = await router.readMatches(20);

  assert.equal(env.ok, true);
  assert.equal(env.backend, "api");
  assert.equal(env.degraded, false);
  assert.equal(env.evidence.length, 20);
  assertEnvelopeShape(env);
  // Device engine was never touched while the API is healthy.
  assert.equal(wda.observeCallCount, 0);
  assert.ok(router.isDegraded() === false);
  // The uniform log line for the attempt is present.
  const attempt = logs.find((l) => l.action === "read_matches" && l.backend === "api");
  assert.ok(attempt, "expected an api read_matches log line");
  assert.equal(attempt.degraded, false);
  assert.equal(attempt.ok, true);
});

test("API 403: router auto-degrades to the device backend with degraded:true", async () => {
  const { apiServer, wda, router, logs } = makeHarness();

  await router.readMatches(20); // healthy first
  apiServer.setMode("403"); // Hinge ships an app update; endpoint dies

  const env = await router.readMatches(20); // same script keeps going

  assert.equal(env.ok, true, "the read still completes — via the other engine");
  assert.equal(env.backend, "device");
  assert.equal(env.degraded, true);
  assert.equal(env.evidence.length, 20);
  assertEnvelopeShape(env);
  assert.ok(wda.observeCallCount >= 1, "device engine was engaged");
  assert.ok(router.isDegraded(), "router latched into degraded mode");

  // Log trail shows the red API line, the degrade event, then the device line.
  const apiFail = logs.find((l) => l.backend === "api" && l.ok === false);
  assert.ok(apiFail, "expected the failed api attempt in the log");
  assert.equal(apiFail.degraded, true);
  const degrade = logs.find((l) => l.action === "router_degrade");
  assert.ok(degrade, "expected a router_degrade log line");
  assert.equal(degrade.backend, "api->device");
  const devOk = logs.find((l) => l.backend === "device" && l.ok === true);
  assert.ok(devOk, "expected the successful device attempt in the log");
  assert.equal(devOk.degraded, true);
});

test("degraded mode: the task continues to completion on the device engine", async () => {
  const { apiServer, wda, router } = makeHarness();

  await router.readMatches(20);
  apiServer.setMode("403");

  // Keep reading — the task must not die with the API.
  const results: ResultEnvelope<Match[]>[] = [];
  for (let i = 0; i < 3; i++) {
    results.push(await router.readMatches(20));
  }

  for (const env of results) {
    assert.equal(env.ok, true);
    assert.equal(env.backend, "device");
    assert.equal(env.degraded, true);
    assert.equal(env.evidence.length, 20, "each degraded read still returns the data");
    assertEnvelopeShape(env);
  }
  // Same data on either engine — the task is the same, only the hand changed.
  const ids = results[0].evidence.map((m) => m.id);
  assert.deepEqual(ids, results[1].evidence.map((m) => m.id));
  assert.ok(wda.observeCallCount >= 3);
});
