// SPDX-License-Identifier: BUSL-1.1

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { DeviceBackend } from "../src/index.ts";
import { MockWdaServer } from "./mock-server.ts";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("degrade chain: tree-first, screenshot fallback, never blind-retry", () => {
  let server: MockWdaServer;
  let backend: DeviceBackend;

  before(async () => {
    server = new MockWdaServer();
    await server.start();
    backend = new DeviceBackend({ baseUrl: server.baseUrl, requestTimeoutMs: 2000 });
    const env = await backend.connect();
    assert.equal(env.ok, true);
  });

  after(async () => {
    server.sourceOverride = null;
    server.resetBehavior();
    await server.stop();
  });

  it("empty tree -> screenshot fallback, degraded + tree_unavailable", async () => {
    server.sourceOverride = "<XCUIElementTypeApplication></XCUIElementTypeApplication>";
    try {
      const env = await backend.observe();
      assert.equal(env.ok, true);
      assert.equal(env.degraded, true);
      assert.equal(env.evidence["tree_unavailable"], true);
      assert.equal(env.evidence["tree"], undefined);
      const shot = env.evidence["screenshot"] as Buffer;
      assert.ok(Buffer.isBuffer(shot));
      assert.ok(shot.subarray(0, 8).equals(PNG_MAGIC));
    } finally {
      server.sourceOverride = null;
    }
  });

  it("malformed tree XML -> screenshot fallback", async () => {
    server.sourceOverride = "this is not xml at all {{{";
    try {
      const env = await backend.observe();
      assert.equal(env.ok, true);
      assert.equal(env.degraded, true);
      assert.equal(env.evidence["tree_unavailable"], true);
      assert.ok(Buffer.isBuffer(env.evidence["screenshot"] as Buffer));
    } finally {
      server.sourceOverride = null;
    }
  });

  it("unreachable tree endpoint -> single attempt then screenshot fallback", async () => {
    server.setBehavior("source", "drop");
    server.resetCalls();
    try {
      const env = await backend.observe();
      assert.equal(env.ok, true);
      assert.equal(env.degraded, true);
      assert.equal(env.evidence["tree_unavailable"], true);
      assert.equal(env.evidence["tree_error"], "connection_lost");
      // Exactly one /source attempt: the backend never blind-retries.
      assert.equal(server.calls.filter((c) => c.path.endsWith("/source")).length, 1);
      assert.equal(server.calls.filter((c) => c.path.endsWith("/screenshot")).length, 1);
    } finally {
      server.setBehavior("source", "ok");
    }
  });

  it("tree AND screenshot both fail -> ok:false, still marked degraded", async () => {
    server.setBehavior("source", "drop");
    server.setBehavior("screenshot", "drop");
    try {
      const env = await backend.observe();
      assert.equal(env.ok, false);
      assert.equal(env.degraded, true);
      assert.equal(env.evidence["tree_unavailable"], true);
      assert.ok(typeof env.evidence["screenshot_error"] === "string");
    } finally {
      server.setBehavior("source", "ok");
      server.setBehavior("screenshot", "ok");
    }
  });

  it("tapText() with no usable tree fails degraded instead of guessing pixels", async () => {
    server.sourceOverride = "";
    try {
      const env = await backend.tapText("Messages");
      assert.equal(env.ok, false);
      assert.equal(env.degraded, true);
      assert.equal(env.evidence["tree_unavailable"], true);
    } finally {
      server.sourceOverride = null;
    }
  });
});
