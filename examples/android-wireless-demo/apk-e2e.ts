// SPDX-License-Identifier: BUSL-1.1

/**
 * apk-e2e — the REAL helper APK, on a real Android OS, through the REAL relay.
 *
 * No mocks: scripts/ci/android-apk-e2e.sh installs the debug APK on the
 * emulator, enables its accessibility service, `adb reverse`s 9011 and starts
 * the agent service (gestures-only, no screen-capture consent). This script is
 * the agent side: it waits for the phone's hello, then drives every action and
 * checks what actually happened on the device.
 *
 * Exit 0 = all assertions held.
 */
import { strict as assert } from "node:assert";
import { AndroidRelayServer } from "../../packages/android-backend/src/index.ts";

const PORT = Number(process.env.PHONEHANDS_E2E_PORT ?? 9011);
const HELLO_TIMEOUT_MS = Number(process.env.PHONEHANDS_E2E_HELLO_TIMEOUT_MS ?? 120_000);

type Node = { text?: string; content_desc?: string; password?: boolean };

async function waitFor<T>(get: () => T | undefined, timeoutMs: number, what: string): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = get();
    if (v !== undefined) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`apk-e2e: timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const server = new AndroidRelayServer({ port: PORT, actionTimeoutMs: 15_000 });
  await server.start();
  console.log(`[apk-e2e] relay listening on 127.0.0.1:${PORT}; waiting for the phone...`);
  try {
    const info = await waitFor(() => server.listDevices()[0], HELLO_TIMEOUT_MS, "hello from the APK");
    console.log(`[apk-e2e] hello: ${server.describe(info.deviceId)}`);
    assert.ok(info.model.length > 0, "hello.model");
    assert.ok(info.width > 0 && info.height > 0, "hello screen size");
    for (const cap of ["tap", "swipe", "launch", "observe", "screenshot"]) {
      assert.ok(info.capabilities.includes(cap), `capability ${cap}`);
    }
    const id = info.deviceId;
    const act = async (action: Parameters<typeof server.sendAction>[1], params: Record<string, unknown> = {}) => {
      const ack = await server.sendAction(id, action, params);
      assert.ok(ack, `${action}: no ack within timeout (action never executed on the phone)`);
      console.log(`[apk-e2e] ${action} -> ok=${ack.ok} error=${ack.error ?? "-"} latency=${ack.latency_ms}ms`);
      return ack;
    };

    const nodesOf = (data: Record<string, unknown> | null): Node[] => {
      const nodes = data?.["nodes"];
      assert.ok(Array.isArray(nodes), "observe.data.nodes is an array");
      return nodes as Node[];
    };

    // 1. observe works and returns a real accessibility tree.
    const first = await act("observe");
    assert.equal(first.ok, true, "observe ok");
    assert.ok(nodesOf(first.data).length > 0, "observe returned nodes");

    // 2. launch really opens the target app: the tree must change to Settings.
    const launch = await act("launch", { package: "com.android.settings" });
    assert.equal(launch.ok, true, "launch ok");
    let sawSettings = false;
    for (let i = 0; i < 20 && !sawSettings; i++) {
      await sleep(500);
      const o = await act("observe");
      sawSettings = nodesOf(o.data).some((n) => /setting/i.test(`${n.text ?? ""} ${n.content_desc ?? ""}`));
    }
    assert.ok(sawSettings, "after launch, the accessibility tree shows the Settings app");

    // 3. gestures are dispatched by the accessibility service.
    const tap = await act("tap", { x: Math.round(info.width / 2), y: Math.round(info.height / 2) });
    assert.equal(tap.ok, true, "tap ok");
    const swipe = await act("swipe", {
      x1: Math.round(info.width / 2), y1: Math.round(info.height * 0.7),
      x2: Math.round(info.width / 2), y2: Math.round(info.height * 0.3), duration_ms: 300,
    });
    assert.equal(swipe.ok, true, "swipe ok");

    // 4. gestures-only mode (no capture consent): screenshot fails honestly.
    const shot = await act("screenshot");
    assert.equal(shot.ok, false, "screenshot without consent must not pretend to succeed");
    assert.match(shot.error ?? "", /screen capture not running/);

    // 5. a bad launch is reported as a failure, not as success.
    const bad = await act("launch", { package: "com.phonehands.does.not.exist" });
    assert.equal(bad.ok, false, "launch of a missing package fails");

    console.log("[apk-e2e] ALL ASSERTIONS PASSED");
  } finally {
    await server.stop();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
