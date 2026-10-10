// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { capabilitiesFor } from "../src/backend.ts";
import { AuthHandoff } from "../src/auth-handoff.ts";
import {
  ActionNotRegisteredError,
  DeviceTypeRequiredError,
  EmergencyStoppedError,
  NoCapableBackendError,
  ResultValidationError,
} from "../src/errors.ts";
import { SerialOpQueue } from "../src/queue.ts";
import { ActionRegistry } from "../src/registry.ts";
import { Router } from "../src/router.ts";
import { AUTH_REQUIRED } from "../src/types.ts";
import { apiBackend, deviceBackend, errResult, MockBackend, okResult } from "./_helpers.ts";

function setup(opts: { apiHandler?: (n: number) => Promise<import("../src/types.ts").ActionResult>; handoff?: AuthHandoff } = {}) {
  const registry = new ActionRegistry();
  let calls = 0;
  const api = apiBackend(async (action, args) => {
    calls += 1;
    if (opts.apiHandler) return opts.apiHandler(calls);
    return okResult({ backend: "api", evidence: { via: "api" } });
  });
  const ios = deviceBackend("ios");
  const android = deviceBackend("android");
  registry.registerBackend(api);
  registry.registerBackend(ios);
  registry.registerBackend(android);
  const router = new Router({ registry, authHandoff: opts.handoff });
  return { registry, router, api, ios, android };
}

describe("router: policy routing", () => {
  it("read-tier actions go to the api backend", async () => {
    const { router, api, ios } = setup();
    const r = await router.dispatch("acct1", "read");
    assert.equal(r.ok, true);
    assert.equal(r.backend, "api");
    assert.equal(r.escalated, false);
    assert.equal(api.calls.length, 1);
    assert.equal(ios.calls.length, 0);
  });

  it("write actions route to ios device backend by deviceType", async () => {
    const { router, ios, android } = setup();
    const r = await router.dispatch("acct1", "tap", { x: 10, y: 20 }, { deviceType: "ios" });
    assert.equal(r.ok, true);
    assert.equal(r.backend, "device");
    assert.equal(r.devicePlatform, "ios");
    assert.equal(ios.calls.length, 1);
    assert.equal(android.calls.length, 0);
    assert.deepEqual(ios.calls[0].args, { x: 10, y: 20 });
  });

  it("write actions route to android device backend by deviceType", async () => {
    const { router, ios, android } = setup();
    const r = await router.dispatch("acct1", "swipe", { dir: "up" }, { deviceType: "android" });
    assert.equal(r.backend, "device");
    assert.equal(r.devicePlatform, "android");
    assert.equal(android.calls.length, 1);
    assert.equal(ios.calls.length, 0);
  });

  it("device action without deviceType throws DEVICE_TYPE_REQUIRED", async () => {
    const { router } = setup();
    await assert.rejects(() => router.dispatch("acct1", "tap", { x: 1, y: 2 }), (e: unknown) => e instanceof DeviceTypeRequiredError);
  });

  it("measures latency_ms on every dispatch", async () => {
    const { router } = setup();
    const r = await router.dispatch("acct1", "read");
    assert.equal(typeof r.latency_ms, "number");
    assert.ok(r.latency_ms >= 0);
  });
});

describe("router: capability-table routing (no hardcoded if-else)", () => {
  it("refuses when no backend declares the action (no silent substitution)", async () => {
    const registry = new ActionRegistry();
    const api = apiBackend();
    // api backend deliberately lacks "read"
    const limited = new MockBackend("limited", "api", capabilitiesFor("observe"), undefined, async () => okResult());
    registry.registerBackend(limited);
    void api;
    const router = new Router({ registry });
    await assert.rejects(() => router.dispatch("acct1", "read"), (e: unknown) => e instanceof NoCapableBackendError);
    assert.equal(limited.calls.length, 0);
  });

  it("explicit allowEscalation substitutes and marks escalated:true", async () => {
    const registry = new ActionRegistry();
    const limited = new MockBackend("limited", "api", capabilitiesFor("observe"), undefined, async () => okResult({ backend: "api" }));
    const ios = deviceBackend("ios");
    registry.registerBackend(limited);
    registry.registerBackend(ios);
    const router = new Router({ registry });
    await assert.rejects(() => router.dispatch("acct1", "read", {}, { deviceType: "ios" }), NoCapableBackendError);
    const r = await router.dispatch("acct1", "read", {}, { deviceType: "ios", allowEscalation: true });
    assert.equal(r.ok, true);
    assert.equal(r.backend, "device");
    assert.equal(r.escalated, true);
    assert.equal(ios.calls.length, 1);
  });

  it("device backend must declare its platform at registration", () => {
    const registry = new ActionRegistry();
    const bad = new MockBackend("bad", "device", capabilitiesFor("tap"), undefined, async () => okResult());
    assert.throws(
      () => registry.registerBackend(bad),
      (e: unknown) => (e as { code?: string }).code === "PLATFORM_DECLARATION"
    );
  });
});

describe("router: degrade on 4xx/timeout (fault injection)", () => {
  it("3 consecutive API 403s mark degraded; reads fall to device with degraded:true", async () => {
    const { router, api } = setup({
      apiHandler: async () => errResult("HTTP_403", "forbidden"),
    });
    void api;
    assert.equal(router.degraded, false);
    await router.dispatch("acct1", "read");
    await router.dispatch("acct1", "read");
    assert.equal(router.degraded, false);
    await router.dispatch("acct1", "read");
    assert.equal(router.degraded, true);

    const r = await router.dispatch("acct1", "read", {}, { deviceType: "ios" });
    assert.equal(r.backend, "device");
    assert.equal(r.degraded, true);
    assert.equal(r.devicePlatform, "ios");
  });

  it("deviceType is still required on the degrade path", async () => {
    const { router } = setup({ apiHandler: async () => errResult("HTTP_403", "forbidden") });
    await router.dispatch("a", "read");
    await router.dispatch("a", "read");
    await router.dispatch("a", "read");
    assert.equal(router.degraded, true);
    await assert.rejects(() => router.dispatch("a", "read"), DeviceTypeRequiredError);
    const r = await router.dispatch("a", "read", {}, { deviceType: "android" });
    assert.equal(r.backend, "device");
    assert.equal(r.devicePlatform, "android");
    assert.equal(r.degraded, true);
  });

  it("fault injection: backend throw with TIMEOUT code counts toward degrade", async () => {
    const registry = new ActionRegistry();
    const flaky = apiBackend(async () => {
      const e = new Error("socket timeout") as Error & { code: string };
      e.code = "TIMEOUT";
      throw e;
    });
    const ios = deviceBackend("ios");
    registry.registerBackend(flaky);
    registry.registerBackend(ios);
    const router = new Router({ registry });
    await router.dispatch("a", "read");
    await router.dispatch("a", "read");
    await router.dispatch("a", "read");
    assert.equal(router.degraded, true);
  });

  it("fault injection: empty/undefined backend response is a safe failure, not a crash", async () => {
    const registry = new ActionRegistry();
    const empty = apiBackend(async () => undefined as unknown as import("../src/types.ts").ActionResult);
    registry.registerBackend(empty);
    const router = new Router({ registry });
    const r = await router.dispatch("a", "read");
    assert.equal(r.ok, false);
    assert.equal(r.backend, "api");
  });

  it("a success resets the consecutive-fault counter", async () => {
    let n = 0;
    const { router } = setup({
      apiHandler: async () => {
        n += 1;
        return n === 3 ? okResult({ backend: "api" }) : errResult("HTTP_429", "slow down");
      },
    });
    await router.dispatch("a", "read"); // fault 1
    await router.dispatch("a", "read"); // fault 2
    await router.dispatch("a", "read"); // success -> reset
    await router.dispatch("a", "read"); // fault 1
    await router.dispatch("a", "read"); // fault 2
    assert.equal(router.degraded, false);
  });

  it("5 consecutive successful probes recover the api engine", async () => {
    const { router, api } = setup({ apiHandler: async () => errResult("HTTP_403", "x") });
    await router.dispatch("a", "read");
    await router.dispatch("a", "read");
    await router.dispatch("a", "read");
    assert.equal(router.degraded, true);
    api.healthy = true;
    for (let i = 0; i < 4; i++) {
      await router.probeApi();
      assert.equal(router.degraded, true);
    }
    await router.probeApi();
    assert.equal(router.degraded, false);
    const r = await router.dispatch("a", "read", {}, {});
    assert.equal(r.backend, "api");
    assert.equal(api.calls.length, 4); // 3 faults + 1 post-recovery
  });

  it("a failed probe resets the recovery streak", async () => {
    const { router, api } = setup({ apiHandler: async () => errResult("HTTP_403", "x") });
    await router.dispatch("a", "read");
    await router.dispatch("a", "read");
    await router.dispatch("a", "read");
    assert.equal(router.degraded, true);

    api.healthy = true;
    await router.probeApi();
    await router.probeApi();
    assert.equal(router.degraded, true);
    api.healthy = false;
    assert.equal(await router.probeApi(), false);
    assert.equal(router.degraded, true, "streak reset by the failed probe");
    api.healthy = true;
    for (let i = 0; i < 5; i++) await router.probeApi();
    assert.equal(router.degraded, false);
  });
});

describe("router: AUTH_REQUIRED is a handoff, not an engine fault", () => {
  it("does not count toward degrade; pauses the account queue", async () => {
    const queue = new SerialOpQueue();
    const handoff = new AuthHandoff({ queue, resumeTimeoutMs: 5000 });
    const { router } = setup({
      handoff,
      apiHandler: async () => ({
        ...errResult("AUTH_REQUIRED", "face id wall"),
        error: { code: AUTH_REQUIRED, message: "face id wall", wallType: "face_id" as const },
      }),
    });
    const r1 = await router.dispatch("acct9", "read");
    const r2 = await router.dispatch("acct9", "read");
    const r3 = await router.dispatch("acct9", "read");
    assert.equal(r1.ok, false);
    assert.equal(r1.error?.code, AUTH_REQUIRED);
    assert.equal(router.degraded, false, "AUTH_REQUIRED must never degrade the api engine");
    assert.equal(handoff.state("acct9"), "PAUSED");
    void r2;
    void r3;
  });
});

describe("router: envelope contract on device results", () => {
  it("backfills devicePlatform from the backend declaration when omitted", async () => {
    const registry = new ActionRegistry();
    const forgetful = new MockBackend(
      "forgetful",
      "device",
      capabilitiesFor("tap"),
      "ios",
      async () => okResult({ backend: "device", evidence: { x: 1 } }) // no devicePlatform in envelope
    );
    registry.registerBackend(forgetful);
    const router = new Router({ registry });
    const r = await router.dispatch("a", "tap", {}, { deviceType: "ios" });
    assert.equal(r.devicePlatform, "ios");
  });

  it("rejects a device envelope that violates the contract", async () => {
    const registry = new ActionRegistry();
    const liar = new MockBackend(
      "liar",
      "device",
      capabilitiesFor("tap"),
      "ios",
      async () => ({ ...okResult({ backend: "device" }), devicePlatform: "api" as unknown as "ios" })
    );
    registry.registerBackend(liar);
    const router = new Router({ registry });
    // "api" is not a valid DevicePlatform -> validation error
    await assert.rejects(() => router.dispatch("a", "tap", {}, { deviceType: "ios" }), ResultValidationError);
  });
});

describe("router: emergency stop (STUB P2-4)", () => {
  it("refuses dispatch while stopped, resumes after clear", async () => {
    const { router } = setup();
    router.emergencyStop();
    await assert.rejects(() => router.dispatch("a", "read"), (e: unknown) => e instanceof EmergencyStoppedError);
    router.clearEmergencyStop();
    const r = await router.dispatch("a", "read");
    assert.equal(r.ok, true);
  });
});

describe("router: unknown actions", () => {
  it("rejects unregistered action names", async () => {
    const { router } = setup();
    await assert.rejects(
      () => router.dispatch("a", "nonexistent" as never),
      (e: unknown) => e instanceof ActionNotRegisteredError
    );
  });
});
