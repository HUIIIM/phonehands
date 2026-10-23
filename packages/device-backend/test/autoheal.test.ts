// SPDX-License-Identifier: BUSL-1.1

/**
 * Auto-heal fault-injection tests (faked-WDA approach, pattern learned
 * from ios-agent's tests/fake_wda.py).
 *
 * Heals + retries ONLY when the action provably never executed:
 *  - SessionLost ("invalid session id"): dead session rejected it.
 *  - RunnerCrashed via connection-refused: runner never saw it.
 * ActionTimeout / ConnectionLost (ambiguous) are NEVER healed or
 * replayed — they surface as ok:false + uncertain:true.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  DeviceBackend,
  RunnerCrashed,
  SessionLost,
  WdaSession,
} from "../src/index.ts";
import { MockWdaServer } from "./mock-server.ts";

describe("auto-heal", () => {
  let server: MockWdaServer;

  before(async () => {
    server = new MockWdaServer();
    await server.start();
  });

  after(async () => {
    await server.stop();
  });

  it("dead session is recreated transparently; tap reports recovered:true", async () => {
    const backend = new DeviceBackend({
      baseUrl: server.baseUrl,
      requestTimeoutMs: 2000,
    });
    assert.equal((await backend.connect()).ok, true);
    const sessionsBefore = server.sessionsCreated;

    server.failNext("/wda/tap", "invalid session id");
    const env = await backend.tap(10, 20);

    assert.equal(env.ok, true);
    assert.equal(env.evidence["recovered"], true);
    assert.equal(backend.recoveredCount, 1);
    // A new session was created and re-tuned...
    assert.equal(server.sessionsCreated, sessionsBefore + 1);
    assert.ok(server.settingsApplied);
    // ...and the tap landed on the healed session: exactly two attempts
    // (the failed one + the single heal retry), never more.
    const taps = server.calls.filter((c) => c.path.endsWith("/wda/tap"));
    assert.equal(taps.length, 2);
    assert.deepEqual(taps[1]?.body, { x: 10, y: 20 });
    await backend.disconnect();
  });

  it("crashed runner mid-session is relaunched; tap reports recovered:true", async () => {
    const serverA = new MockWdaServer();
    await serverA.start();
    let serverB: MockWdaServer | null = null;
    const relaunches: string[] = [];
    const backend = new DeviceBackend({
      baseUrl: serverA.baseUrl,
      requestTimeoutMs: 2000,
      session: {
        autoHeal: true,
        relaunch: async () => {
          serverB = new MockWdaServer();
          await serverB.start();
          relaunches.push(serverB.baseUrl);
          return serverB.baseUrl;
        },
      },
    });
    assert.equal((await backend.connect()).ok, true);

    // Kill runner A mid-session: the next tap gets ECONNREFUSED.
    await serverA.stop();
    const env = await backend.tap(7, 8);

    assert.equal(env.ok, true);
    assert.equal(env.evidence["recovered"], true);
    assert.equal(relaunches.length, 1);
    assert.equal(backend.recoveredCount, 1);
    // The tap landed on the relaunched runner, exactly once.
    const b = serverB as unknown as MockWdaServer;
    const tapsB = b.calls.filter((c) => c.path.endsWith("/wda/tap"));
    assert.equal(tapsB.length, 1);
    assert.deepEqual(tapsB[0]?.body, { x: 7, y: 8 });
    // Snapshot tuning re-applied on the new runner's session.
    assert.ok(b.settingsApplied);
    await backend.disconnect();
    await b.stop();
  });

  it("auto-heal can be disabled: SessionLost surfaces, no retry", async () => {
    const backend = new DeviceBackend({
      baseUrl: server.baseUrl,
      requestTimeoutMs: 2000,
      session: { autoHeal: false },
    });
    assert.equal((await backend.connect()).ok, true);
    const sessionsBefore = server.sessionsCreated;
    server.failNext("/wda/tap", "invalid session id");
    const env = await backend.tap(5, 5);
    assert.equal(env.ok, false);
    assert.equal(env.evidence["reason"], "session_lost");
    assert.equal(env.evidence["uncertain"], false);
    assert.equal(server.sessionsCreated, sessionsBefore); // no new session
    assert.equal(backend.recoveredCount, 0);
    await backend.disconnect();
  });

  it("timeout on tap is uncertain and NEVER healed or replayed", async () => {
    const backend = new DeviceBackend({
      baseUrl: server.baseUrl,
      requestTimeoutMs: 400,
      session: { autoHeal: true },
    });
    assert.equal((await backend.connect()).ok, true);
    const sessionsBefore = server.sessionsCreated;
    server.resetCalls();
    server.setBehavior("tap", "hang");
    try {
      const env = await backend.tap(10, 20);
      assert.equal(env.ok, false);
      assert.equal(env.evidence["uncertain"], true);
      assert.equal(env.evidence["reason"], "action_timeout");
      // No heal, no retry: session count unchanged, single attempt.
      assert.equal(server.sessionsCreated, sessionsBefore);
      assert.equal(
        server.calls.filter((c) => c.path.endsWith("/wda/tap")).length,
        1,
      );
      assert.equal(backend.recoveredCount, 0);
    } finally {
      server.setBehavior("tap", "ok");
    }
    await backend.disconnect();
  });

  it("mid-flight disconnect on type is uncertain and never replayed", async () => {
    const backend = new DeviceBackend({
      baseUrl: server.baseUrl,
      requestTimeoutMs: 2000,
      session: { autoHeal: true },
    });
    assert.equal((await backend.connect()).ok, true);
    server.setBehavior("type", "drop");
    try {
      const env = await backend.type("nope");
      assert.equal(env.ok, false);
      assert.equal(env.evidence["uncertain"], true);
      assert.equal(env.evidence["reason"], "connection_lost");
      assert.equal(backend.recoveredCount, 0);
    } finally {
      server.setBehavior("type", "ok");
    }
    await backend.disconnect();
  });
});

describe("WdaSession heal restores the foreground app", () => {
  let server: MockWdaServer;

  before(async () => {
    server = new MockWdaServer();
    await server.start();
  });

  after(async () => {
    await server.stop();
  });

  it("launchApp then crash: healed session re-launches the same bundle", async () => {
    const session = new WdaSession(server.baseUrl, { autoHeal: true });
    await session.open("com.example.app");
    assert.equal(server.activeBundle, "com.example.app");

    server.failNext("/wda/tap", "invalid session id");
    const recovered = await session.tap(3, 4);
    assert.equal(recovered, true);
    assert.equal(session.recoveredCount, 1);
    // Foreground app restored after the heal.
    assert.equal(server.activeBundle, "com.example.app");
    await session.close();
  });

  it("heal without a relaunch hook raises a clear RunnerCrashed", async () => {
    const closedPort = await closedTcpPort();
    const dead = new WdaSession(`http://127.0.0.1:${closedPort}`, {
      autoHeal: true,
    });
    await assert.rejects(() => dead.tap(1, 1), RunnerCrashed);
  });

  it("SessionLost is a typed, non-uncertain error", () => {
    const err = new SessionLost("x");
    assert.equal(err.code, "session_lost");
    assert.equal(err.recoverable, true);
  });
});

/** Binds a port, closes it, returns it: almost surely still closed. */
async function closedTcpPort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}
