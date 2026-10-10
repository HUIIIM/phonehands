// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/**
 * android-wireless-demo — MVP acceptance #7 shape proof.
 *
 * Flow: start relay server (from PHONEHANDS_RELAY_URL) -> connect mock
 * phone -> wait for a streamed frame -> tap -> screenshot -> observe ->
 * launch -> assert each envelope -> print unified healthcheck JSON ->
 * shut down.
 *
 * Exit 0 = all assertions held. The final stdout line is the unified
 * healthcheck schema shared with the iOS side:
 *   { relay, reachable, latency_ms, path }
 */
import { strict as assert } from "node:assert";
import {
  AndroidDevice,
  AndroidRelayServer,
  checkRelay,
  MockAndroidDevice,
  relayUrlFromEnv,
  parseRelayUrl,
} from "../../packages/android-backend/src/index.ts";

const RELAY_URL = relayUrlFromEnv();
const { port, pathKind } = parseRelayUrl(RELAY_URL);

async function waitFor(cond: () => boolean, timeoutMs = 8_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("demo: waitFor timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function main(): Promise<void> {
  console.log(`[demo] relay: ${RELAY_URL} (path=${pathKind})`);

  const server = new AndroidRelayServer({ port });
  await server.start();
  console.log("[demo] relay server listening");

  const phone = new MockAndroidDevice(RELAY_URL, { deviceId: "demo-phone-1" });
  await phone.connect();
  await waitFor(() => server.listDevices().length === 1);
  console.log("[demo] phone connected:", server.describe("demo-phone-1"));

  const device = new AndroidDevice(server, server.listDevices()[0]);
  await waitFor(() => device.info.latestFrame !== null);
  console.log(`[demo] screen frame received (${device.info.latestFrame!.width}x${device.info.latestFrame!.height})`);

  const tap = await device.tap(180, 390);
  assert.equal(tap.ok, true, "tap must succeed");
  assert.equal(tap.devicePlatform, "android");
  console.log("[demo] tap ok, latency_ms =", tap.latency_ms);

  const shot = await device.screenshot();
  assert.equal(shot.ok, true, "screenshot must succeed");
  const jpeg = shot.evidence.jpeg_bytes as Buffer;
  assert.ok(jpeg[0] === 0xff && jpeg[1] === 0xd8, "must be a JPEG");
  console.log("[demo] screenshot ok, bytes =", jpeg.length);

  const obs = await device.observe();
  assert.equal(obs.ok, true, "observe must succeed");
  assert.ok((obs.evidence.nodes as unknown[]).length > 0, "tree must be non-empty");
  console.log("[demo] observe ok, nodes =", (obs.evidence.nodes as unknown[]).length);

  const launch = await device.launch("com.example.app");
  assert.equal(launch.ok, true, "launch must succeed");
  console.log("[demo] launch ok");

  await phone.disconnect();

  // Unified healthcheck while the relay is still up (reachable: true).
  const health = await checkRelay(RELAY_URL);
  console.log(JSON.stringify(health));

  await server.stop();

  console.log("[demo] ALL ASSERTIONS PASSED");
}

main().catch((err) => {
  console.error("[demo] FAILED:", err?.message ?? err);
  process.exit(1);
});
