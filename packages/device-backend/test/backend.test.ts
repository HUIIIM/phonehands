// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { DeviceBackend } from "../src/index.ts";
import { MockWdaServer } from "./mock-server.ts";

describe("DeviceBackend against mock WDA", () => {
  let server: MockWdaServer;
  let backend: DeviceBackend;

  before(async () => {
    server = new MockWdaServer();
    await server.start();
    backend = new DeviceBackend({ baseUrl: server.baseUrl, requestTimeoutMs: 2000 });
  });

  after(async () => {
    await server.stop();
  });

  it("connect() bootstraps an unbound session + snapshot tuning", async () => {
    server.resetCalls();
    server.settingsApplied = null;
    const env = await backend.connect();
    assert.equal(env.ok, true);
    assert.equal(env.backend, "device");
    assert.equal(env.degraded, false);
    assert.ok(typeof env.latency_ms === "number" && env.latency_ms >= 0);

    // Session bootstrap: unbound (no bundleId), shouldTerminateApp:false.
    const sessionCall = server.calls.find((c) => c.path === "/session");
    assert.ok(sessionCall, "POST /session recorded");
    const caps = (sessionCall?.body as { capabilities?: Record<string, unknown> })
      ?.capabilities;
    assert.ok(caps, "capabilities sent");
    assert.equal(
      (caps["alwaysMatch"] as Record<string, unknown>)?.["shouldTerminateApp"],
      false,
    );
    assert.equal(JSON.stringify(caps).includes("bundleId"), false);

    // Snapshot tuning pushed on the fresh session (ios-agent defaults).
    const settings = server.settingsApplied as {
      settings?: Record<string, unknown>;
    } | null;
    assert.ok(settings, "POST /appium/settings recorded");
    assert.deepEqual(settings?.settings, {
      snapshotMaxDepth: 50,
      snapshotMaxChildren: 64,
      customSnapshotTimeout: 5.0,
      waitForIdleTimeout: 2.0,
      useFirstMatch: true,
    });
  });

  it("tap() hits /wda/tap with x,y, exactly once", async () => {
    server.resetCalls();
    const env = await backend.tap(100, 200);
    assert.equal(env.ok, true);
    assert.equal(env.backend, "device");
    const taps = server.calls.filter((c) => c.path.endsWith("/wda/tap"));
    assert.equal(taps.length, 1);
    assert.deepEqual(taps[0]?.body, { x: 100, y: 200 });
  });

  it("swipe() converts durationMs to seconds for dragfromtoforduration", async () => {
    server.resetCalls();
    const env = await backend.swipe(100, 800, 100, 200, 500);
    assert.equal(env.ok, true);
    const swipes = server.calls.filter((c) =>
      c.path.endsWith("/wda/dragfromtoforduration"),
    );
    assert.equal(swipes.length, 1);
    assert.deepEqual(swipes[0]?.body, {
      fromX: 100,
      fromY: 800,
      toX: 100,
      toY: 200,
      duration: 0.5,
    });
  });

  it("type() posts W3C keys and never echoes text into evidence/audit", async () => {
    server.resetCalls();
    const env = await backend.type("hello");
    assert.equal(env.ok, true);
    const keys = server.calls.filter((c) => c.path.endsWith("/keys"));
    assert.equal(keys.length, 1);
    assert.deepEqual(keys[0]?.body, { value: ["hello"] });
    assert.equal(JSON.stringify(env.evidence).includes("hello"), false);
  });

  it("observe() returns the parsed tree on the happy path", async () => {
    server.resetCalls();
    const env = await backend.observe();
    assert.equal(env.ok, true);
    assert.equal(env.degraded, false);
    const tree = env.evidence["tree"] as { nodes: Array<{ label: string }> };
    assert.ok(Array.isArray(tree.nodes) && tree.nodes.length > 0);
    assert.ok(tree.nodes.some((n) => n.label === "Messages"));
    assert.equal(env.evidence["tree_unavailable"], undefined);
    assert.equal(backend.lastTree()?.nodes.length, tree.nodes.length);
  });

  it("tapText() finds a label in the tree and taps its center", async () => {
    server.resetCalls();
    // Fixture button: x=20,y=700,w=60,h=60 -> center (50, 730)
    const env = await backend.tapText("Messages");
    assert.equal(env.ok, true);
    const taps = server.calls.filter((c) => c.path.endsWith("/wda/tap"));
    assert.equal(taps.length, 1);
    assert.deepEqual(taps[0]?.body, { x: 50, y: 730 });
  });

  it("screenshot() returns PNG bytes with valid magic", async () => {
    const env = await backend.screenshot();
    assert.equal(env.ok, true);
    const shot = env.evidence["screenshot"] as Buffer;
    assert.ok(Buffer.isBuffer(shot));
    assert.ok(
      shot
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    );
  });

  it("windowSize() returns logical points", async () => {
    const size = await backend.windowSize();
    assert.deepEqual(size, { width: 390, height: 844 });
  });

  it("constructor rejects a remote device address", () => {
    assert.throws(
      () => new DeviceBackend({ baseUrl: "http://192.168.1.10:8100" }),
      /loopback/i,
    );
  });

  it("disconnect() deletes the session", async () => {
    server.resetCalls();
    const env = await backend.disconnect();
    assert.equal(env.ok, true);
    assert.equal(
      server.calls.some(
        (c) => c.method === "DELETE" && c.path.includes("/session/"),
      ),
      true,
    );
  });
});
