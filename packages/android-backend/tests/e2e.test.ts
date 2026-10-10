// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { AndroidRelayServer } from "../src/server.ts";
import { AndroidDevice } from "../src/device.ts";
import { MockAndroidDevice, MOCK_JPEG_B64 } from "../src/mock-device.ts";
import { checkRelay } from "../src/healthcheck.ts";

function relayUrl(port: number): string {
  return `ws://127.0.0.1:${port}/phonehands-android`;
}

async function waitFor(cond: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

test("e2e: mock phone connects, hello registers, frames stream", async () => {
  const server = new AndroidRelayServer({ port: 0 });
  await server.start();
  const port = server.boundPort!;
  const phone = new MockAndroidDevice(relayUrl(port));
  await phone.connect();
  try {
    await waitFor(() => server.listDevices().length === 1);
    const [info] = server.listDevices();
    assert.equal(info.deviceId, "mock-phone-1");
    assert.deepEqual(info.capabilities, ["tap", "swipe", "screenshot", "launch", "observe"]);
    await waitFor(() => info.latestFrame !== null);
    assert.equal(info.latestFrame!.format, "jpeg");
  } finally {
    await phone.disconnect();
    await server.stop();
  }
});

test("e2e: tap/swipe/launch roundtrip through AndroidDevice envelope", async () => {
  const server = new AndroidRelayServer({ port: 0 });
  await server.start();
  const phone = new MockAndroidDevice(relayUrl(server.boundPort!));
  await phone.connect();
  try {
    await waitFor(() => server.listDevices().length === 1);
    const dev = new AndroidDevice(server, server.listDevices()[0]);
    await waitFor(() => dev.info.latestFrame !== null);

    const tap = await dev.tap(180, 390); // frame pixels on the 360x780 stream
    assert.equal(tap.ok, true);
    assert.equal(tap.backend, "device");
    assert.equal(tap.devicePlatform, "android");
    assert.equal(tap.degraded, false);

    const swipe = await dev.swipe(180, 600, 180, 200, 300);
    assert.equal(swipe.ok, true);

    const launch = await dev.launch("com.example.app");
    assert.equal(launch.ok, true);

    // The mock phone saw all three actions, with tap scaled to device px.
    const actions = phone.receivedActions.map((a) => a.action);
    assert.deepEqual(actions, ["tap", "swipe", "launch"]);
    const tapParams = phone.receivedActions[0].params as Record<string, number>;
    assert.equal(tapParams.x, 540); // 180/360 * 1080
    assert.equal(tapParams.y, 1200); // 390/780 * 2400
  } finally {
    await phone.disconnect();
    await server.stop();
  }
});

test("e2e: screenshot returns a decodable JPEG buffer", async () => {
  const server = new AndroidRelayServer({ port: 0 });
  await server.start();
  const phone = new MockAndroidDevice(relayUrl(server.boundPort!));
  await phone.connect();
  try {
    await waitFor(() => server.listDevices().length === 1);
    const dev = new AndroidDevice(server, server.listDevices()[0]);
    const shot = await dev.screenshot();
    assert.equal(shot.ok, true);
    const buf = shot.evidence.jpeg_bytes as Buffer;
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 0);
    // JPEG magic bytes: SOI FF D8 FF ... FFD9 EOI
    assert.equal(buf[0], 0xff);
    assert.equal(buf[1], 0xd8);
    assert.equal(buf[buf.length - 2], 0xff);
    assert.equal(buf[buf.length - 1], 0xd9);
    assert.equal(shot.evidence.width, 360);
    assert.equal(shot.evidence.frame_age_ms, 12);
  } finally {
    await phone.disconnect();
    await server.stop();
  }
});

test("e2e: observe returns the mock accessibility tree", async () => {
  const server = new AndroidRelayServer({ port: 0 });
  await server.start();
  const phone = new MockAndroidDevice(relayUrl(server.boundPort!));
  await phone.connect();
  try {
    await waitFor(() => server.listDevices().length === 1);
    const dev = new AndroidDevice(server, server.listDevices()[0]);
    const obs = await dev.observe();
    assert.equal(obs.ok, true);
    const nodes = obs.evidence.nodes as unknown[];
    assert.equal(nodes.length, 2);
    assert.equal(obs.evidence.truncated, false);
  } finally {
    await phone.disconnect();
    await server.stop();
  }
});

test("fault injection: silent phone -> tap times out as UNCERTAIN (never replayed)", async () => {
  const server = new AndroidRelayServer({ port: 0, actionTimeoutMs: 300 });
  await server.start();
  const url = relayUrl(server.boundPort!);
  // A phone that says hello but never acks actions.
  const silent = new WebSocket(url);
  await new Promise<void>((res, rej) => {
    silent.once("open", () => res());
    silent.once("error", rej);
  });
  silent.send(
    JSON.stringify({
      type: "hello",
      device_id: "silent-1",
      platform: "android",
      model: "silent",
      width: 1080,
      height: 2400,
      density_dpi: 420,
      capabilities: ["tap"],
      token: "",
    }),
  );
  try {
    await waitFor(() => server.listDevices().length === 1);
    const dev = new AndroidDevice(server, server.listDevices()[0]);
    // Give it a frame so coordinate mapping passes and the action is sent.
    dev.info.latestFrame = {
      type: "frame", seq: 1, ts: Date.now(), width: 360, height: 780,
      format: "jpeg", jpeg_b64: MOCK_JPEG_B64,
    };
    const tap = await dev.tap(100, 100);
    assert.equal(tap.ok, false);
    assert.equal(tap.evidence.uncertain, true, "mutating timeout must be uncertain, not failed");
    assert.equal(tap.evidence.reason, "no ack (timeout or disconnect)");
  } finally {
    silent.close();
    await server.stop();
  }
});

test("auth: wrong token is rejected, right token accepted", async () => {
  const server = new AndroidRelayServer({ port: 0, authToken: "correct-token" });
  await server.start();
  const url = relayUrl(server.boundPort!);
  const bad = new MockAndroidDevice(url, { deviceId: "bad-1", token: "wrong-token" });
  await bad.connect();
  try {
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(
      server.listDevices().length,
      0,
      "device with wrong token must not be registered",
    );
  } finally {
    await bad.disconnect();
  }
  const good = new MockAndroidDevice(url, { deviceId: "good-1", token: "correct-token" });
  await good.connect();
  try {
    await waitFor(() => server.listDevices().length === 1);
    assert.equal(server.listDevices()[0].deviceId, "good-1");
  } finally {
    await good.disconnect();
    await server.stop();
  }
});

test("reconnect with same device_id replaces the stale socket (no duplicates)", async () => {
  const server = new AndroidRelayServer({ port: 0 });
  await server.start();
  const url = relayUrl(server.boundPort!);
  const p1 = new MockAndroidDevice(url, { deviceId: "dup-1" });
  await p1.connect();
  await waitFor(() => server.listDevices().length === 1);
  const p2 = new MockAndroidDevice(url, { deviceId: "dup-1" });
  await p2.connect();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(server.listDevices().length, 1, "must dedupe by device_id");
  await p1.disconnect().catch(() => {});
  await p2.disconnect();
  await server.stop();
});

test("healthcheck: unified schema against live server and dead port", async () => {
  const server = new AndroidRelayServer({ port: 0 });
  await server.start();
  const url = relayUrl(server.boundPort!);
  try {
    const live = await checkRelay(url);
    assert.equal(live.relay, url);
    assert.equal(live.reachable, true);
    assert.ok(live.latency_ms >= 0);
    assert.equal(live.path, "direct");
  } finally {
    await server.stop();
  }
  const dead = await checkRelay("ws://127.0.0.1:1/phonehands-android", 1_000);
  assert.equal(dead.reachable, false);
  assert.equal(dead.latency_ms, -1);
  assert.equal(dead.path, "direct");
});
