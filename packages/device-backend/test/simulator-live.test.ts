// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/**
 * simulator-live.test.ts — CI-only live test against a REAL WebDriverAgent
 * running on an iOS Simulator (GitHub Actions macOS runner, gate 4a).
 *
 * This file is SKIPPED unless PHONEHANDS_WDA_URL is set (the ios-simulator
 * workflow sets it to http://127.0.0.1:8100). Local `npm test` is unaffected.
 *
 * What it proves (no mocks anywhere in this file):
 *   1. Real session bootstrap: unbound session + snapshot tuning against real WDA.
 *   2. REAL auto-heal: the session is killed out-of-band (raw HTTP DELETE);
 *      the next session-scoped call must come back with recovered=true.
 *      (Auto-heal *logic* is also covered deterministically by autoheal.test.ts
 *      against the mock server; this is the end-to-end proof against real WDA.)
 *   3. Full DeviceBackend envelope chain against real WDA:
 *      connect / health / windowSize / observe (real tree parse) /
 *      screenshot (real PNG magic) / tap / swipe / disconnect.
 *
 * Honest scope: this validates the ENTIRE WDA protocol chain our client
 * speaks, on a real iOS simulator OS. It does NOT validate physical-device
 * quirks (touch sampling, system dialogs, network handoffs, 7-day signing)
 * — those are gate 4b (physical device farm). Never cite this file as
 * "real-device testing passed".
 *
 * Side effects: taps/swipes land on the simulator SpringBoard and may open
 * apps. The CI simulator is disposable; this is expected and harmless.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import {
  DeviceBackend,
  WdaSession,
  parseAccessibilityTree,
} from "../src/index.ts";

const WDA_URL = process.env.PHONEHANDS_WDA_URL?.trim() || "";
const LIVE = WDA_URL.length > 0;

if (!LIVE) {
  console.log(
    "[simulator-live] PHONEHANDS_WDA_URL not set — skipping (CI-only file).",
  );
}

/** Raw HTTP DELETE of a WDA session (out-of-band kill, no client involved). */
function deleteSessionRaw(baseUrl: string, sessionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(`/session/${sessionId}`, baseUrl);
    const req = http.request(
      url,
      { method: "DELETE", timeout: 15_000 },
      (res) => {
        res.resume();
        res.on("end", () => resolve());
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("DELETE /session timed out")));
    req.end();
  });
}

describe("device-backend vs REAL WDA on iOS Simulator (CI-only)", { skip: !LIVE }, () => {
  let session: WdaSession;
  let backend: DeviceBackend;

  before(async () => {
    // Real WDA session bootstrap is slow on first boot (simulator + runner
    // spin-up). Generous timeout for the whole live file.
    session = new WdaSession(WDA_URL, {
      transport: { requestTimeoutMs: 120_000 },
    });
    backend = new DeviceBackend({
      baseUrl: WDA_URL,
      requestTimeoutMs: 120_000,
      deviceName: "ci-simulator",
    });
  });

  after(async () => {
    try {
      await backend.disconnect();
    } catch {
      /* best effort on a disposable simulator */
    }
    try {
      await session.close();
    } catch {
      /* best effort */
    }
  });

  it("opens a real unbound session on the simulator", async () => {
    const sid = await session.open();
    assert.ok(typeof sid === "string" && sid.length > 0, "real session id");
    assert.equal(session.activeSessionId, sid);
    await session.applySnapshotTuning();
  });

  it("auto-heals for real: out-of-band session kill -> recovered=true", async () => {
    const sid = session.activeSessionId;
    assert.ok(sid, "session must be open");
    // Kill the session behind the client's back. The client never saw it die.
    await deleteSessionRaw(WDA_URL, sid!);
    // Next session-scoped call must detect the dead session, rebuild it,
    // retry once, and report recovered=true. This is the MV427 path firing
    // against a real runner — not a mock.
    const { xml, recovered } = await session.sourceXml();
    assert.equal(recovered, true, "auto-heal must have fired");
    assert.ok(xml.length > 100, "real accessibility XML returned after heal");
    assert.ok(
      session.activeSessionId && session.activeSessionId !== sid,
      "healed session is a NEW session id",
    );
  });

  it("DeviceBackend envelope chain: connect", async () => {
    const env = await backend.connect();
    assert.equal(env.ok, true);
    assert.equal(env.backend, "device");
    assert.equal(env.degraded, false);
  });

  it("DeviceBackend envelope chain: health + windowSize (real values)", async () => {
    const health = await backend.health();
    assert.equal(health.ok, true);
    const size = await backend.windowSize();
    assert.ok(size.width >= 320 && size.height >= 568, `sane points size: ${JSON.stringify(size)}`);
  });

  it("DeviceBackend envelope chain: observe parses a REAL control tree", async () => {
    const env = await backend.observe();
    assert.equal(env.ok, true);
    const tree = env.evidence["tree"] as { nodes: Array<unknown> } | undefined;
    assert.ok(tree && tree.nodes.length > 0, "real SpringBoard tree has nodes");
    // The tree came from a real /source XML, not the fixture.
    assert.equal(env.evidence["tree_unavailable"], undefined);
  });

  it("DeviceBackend envelope chain: screenshot is a real PNG", async () => {
    const env = await backend.screenshot();
    assert.equal(env.ok, true);
    const bytes = env.evidence["screenshot"] as Buffer;
    assert.ok(Buffer.isBuffer(bytes) && bytes.length > 1000, "real screenshot bytes");
    assert.deepEqual(
      [bytes[0], bytes[1], bytes[2], bytes[3]],
      [0x89, 0x50, 0x4e, 0x47],
      "PNG magic",
    );
  });

  it("DeviceBackend envelope chain: tap + swipe envelopes ok", async () => {
    // Coordinates land on SpringBoard; side effects (opening an app) are
    // expected and harmless on the disposable CI simulator.
    const tap = await backend.tap(200, 400);
    assert.equal(tap.ok, true);
    assert.equal(tap.backend, "device");
    const swipe = await backend.swipe(200, 700, 200, 200, 500);
    assert.equal(swipe.ok, true);
  });

  it("parseAccessibilityTree handles the real simulator XML", async () => {
    const { xml } = await session.sourceXml();
    const tree = parseAccessibilityTree(xml);
    assert.ok(tree && tree.nodes.length > 0, "real XML parses to nodes");
  });
});
