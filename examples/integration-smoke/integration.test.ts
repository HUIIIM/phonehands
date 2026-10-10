// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)
// Cross-package integration smoke: REAL @phonehands/core Router +
// REAL HingeApiAdapter (adapters/hinge) + REAL DeviceBackend
// (packages/device-backend), both against mock servers.
//
// This is the dual-engine contract proven end to end with no mocks
// standing in for the packages themselves:
//   read 20 matches via the API engine
//   -> inject a 403 -> Router marks the API engine degraded
//   -> the next read degrades to the device engine, envelope stamped degraded:true.
//
// Run: npm test (from this directory). Node >= 22.18 (type stripping).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ActionRegistry,
  Router,
  capabilitiesFor,
  type ActionName,
  type ActionResult,
  type Backend,
  type BackendKind,
  type DevicePlatform,
} from "../../packages/core/src/index.ts";
import { HingeApiAdapter } from "../../adapters/hinge/src/hinge-adapter.ts";
import {
  startMockHingeServer,
  type MockHingeServer,
} from "../../adapters/hinge/src/mock-server.ts";
import { DeviceBackend } from "../../packages/device-backend/src/index.ts";
import { MockWdaServer } from "../../packages/device-backend/test/mock-server.ts";
import type { UiTree } from "../../packages/device-backend/src/types.ts";

/** Thin core.Backend wrapper around the real hinge API adapter. */
class ApiBackend implements Backend {
  readonly name = "hinge-api";
  readonly kind: BackendKind = "api";
  readonly capabilities = capabilitiesFor("read", "observe");
  private readonly adapter: HingeApiAdapter;
  constructor(adapter: HingeApiAdapter) {
    this.adapter = adapter;
  }

  async invoke(action: ActionName, args: Record<string, unknown>): Promise<ActionResult> {
    if (action !== "read") {
      return {
        ok: false,
        backend: "api",
        latency_ms: 0,
        degraded: false,
        escalated: false,
        evidence: null,
        error: { code: "NOT_SUPPORTED", message: `hinge-api cannot ${action}` },
      };
    }
    const started = Date.now();
    const env = await this.adapter.matches({
      limit: typeof args.limit === "number" ? args.limit : 20,
      fault: typeof args.fault === "string" ? args.fault : undefined,
    });
    return {
      ok: env.ok,
      backend: "api",
      latency_ms: Date.now() - started,
      degraded: env.degraded,
      escalated: false,
      evidence: env.evidence,
      ...(env.error ? { error: env.error } : {}),
    };
  }

  async checkHealth(): Promise<boolean> {
    return true;
  }
}

/** Thin core.Backend wrapper around the real WDA device backend. */
class IosDeviceBackend implements Backend {
  readonly name = "wda-ios";
  readonly kind: BackendKind = "device";
  readonly devicePlatform: DevicePlatform = "ios";
  readonly capabilities = capabilitiesFor("read", "observe");
  private readonly device: DeviceBackend;
  constructor(device: DeviceBackend) {
    this.device = device;
  }

  async invoke(_action: ActionName, _args: Record<string, unknown>): Promise<ActionResult> {
    const started = Date.now();
    const env = await this.device.observe();
    const tree = env.evidence["tree"] as UiTree | undefined;
    const matchNames = (tree?.nodes ?? [])
      .filter((n) => n.type === "XCUIElementTypeStaticText" && n.name.length > 0)
      .map((n) => n.name);
    return {
      ok: env.ok,
      backend: "device",
      devicePlatform: "ios",
      latency_ms: Date.now() - started,
      degraded: false, // the Router stamps degraded:true when serving a degraded read
      escalated: false,
      evidence: { matchNames, nodeCount: matchNames.length },
    };
  }

  async checkHealth(): Promise<boolean> {
    return true;
  }
}

/** A Hinge matches screen as seen through the WDA accessibility tree:
 *  20 match names the device engine can read after the API engine dies. */
const HINGE_TREE_XML =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<XCUIElementTypeApplication type="XCUIElementTypeApplication" name="Hinge" label="Hinge" enabled="true" visible="true" x="0" y="0" width="390" height="844">\n` +
  `  <XCUIElementTypeWindow type="XCUIElementTypeWindow" enabled="true" visible="true" x="0" y="0" width="390" height="844">\n` +
  Array.from({ length: 20 }, (_, i) => {
    const n = i + 1;
    const y = 100 + i * 35;
    return `    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Match ${n}" label="Match ${n}" value="" enabled="true" visible="true" x="20" y="${y}" width="200" height="30"/>\n`;
  }).join("") +
  `  </XCUIElementTypeWindow>\n` +
  `</XCUIElementTypeApplication>`;

describe("cross-package dual-engine integration (real Router + real backends)", () => {
  let hinge: MockHingeServer;
  let wda: MockWdaServer;
  let router: Router;

  before(async () => {
    hinge = await startMockHingeServer();
    wda = new MockWdaServer();
    await wda.start();
    wda.sourceOverride = HINGE_TREE_XML;

    const adapter = new HingeApiAdapter({
      baseUrl: hinge.url,
      locale: { language: "en-US", region: "US" },
      sessionDir: mkdtempSync(join(tmpdir(), "ph-integration-")),
    });
    // Login against the mock server (test OTP accepted by the mock).
    await adapter.auth.install();
    await adapter.auth.initiate("+15550001111");
    await adapter.auth.submitOtp("+15550001111", "000000");

    const device = new DeviceBackend({ baseUrl: wda.baseUrl });
    await device.connect();

    const registry = new ActionRegistry();
    registry.registerBackend(new ApiBackend(adapter));
    registry.registerBackend(new IosDeviceBackend(device));
    router = new Router({ registry, degradeAfterFaults: 1 });
  });

  after(async () => {
    await hinge.close();
    await wda.stop();
  });

  it("reads 20 matches through the real API engine", async () => {
    const r = await router.dispatch("acct-1", "read", { limit: 20 });
    assert.equal(r.ok, true);
    assert.equal(r.backend, "api");
    assert.equal(r.degraded, false);
    const items = (r.evidence as { items: unknown[] }).items;
    assert.equal(items.length, 20);
  });

  it("a real 403 marks the API engine degraded", async () => {
    const r = await router.dispatch("acct-1", "read", { fault: "403" });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, "HTTP_403");
    assert.equal(router.degraded, true);
  });

  it("the next read degrades to the real device engine with degraded:true", async () => {
    const r = await router.dispatch("acct-1", "read", {}, { deviceType: "ios" });
    assert.equal(r.ok, true);
    assert.equal(r.backend, "device");
    assert.equal(r.degraded, true);
    assert.equal(r.devicePlatform, "ios");
    const names = (r.evidence as { matchNames: string[] }).matchNames;
    assert.equal(names.length, 20);
    assert.equal(names[0], "Match 1");
  });
});
