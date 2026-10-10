// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeUplink,
  describeMessage,
  encodeAction,
  encodePing,
  newActionId,
  ProtocolError,
} from "../src/protocol.ts";

test("encodeAction produces the documented downlink shape", () => {
  const raw = encodeAction("id-1", "tap", { x: 100, y: 200 });
  assert.deepEqual(JSON.parse(raw), {
    type: "action",
    id: "id-1",
    action: "tap",
    params: { x: 100, y: 200 },
  });
});

test("encodePing produces the documented shape", () => {
  assert.deepEqual(JSON.parse(encodePing("p-1")), { type: "ping", id: "p-1" });
});

test("newActionId is unique per call", () => {
  assert.notEqual(newActionId(), newActionId());
});

test("decode hello roundtrip", () => {
  const hello = JSON.stringify({
    type: "hello",
    device_id: "d1",
    platform: "android",
    model: "Mock",
    width: 1080,
    height: 2400,
    density_dpi: 420,
    capabilities: ["tap"],
    token: "t",
  });
  const msg = decodeUplink(hello);
  assert.equal(msg.type, "hello");
  if (msg.type === "hello") {
    assert.equal(msg.device_id, "d1");
    assert.deepEqual(msg.capabilities, ["tap"]);
  }
});

test("decode ack and frame roundtrip", () => {
  const ack = decodeUplink(
    JSON.stringify({ type: "ack", id: "a1", ok: true, latency_ms: 5, error: null, data: null }),
  );
  assert.equal(ack.type, "ack");
  const frame = decodeUplink(
    JSON.stringify({
      type: "frame", seq: 1, ts: 2, width: 360, height: 780, format: "jpeg", jpeg_b64: "AA==",
    }),
  );
  assert.equal(frame.type, "frame");
  const pong = decodeUplink(JSON.stringify({ type: "pong", id: "p9" }));
  assert.deepEqual(pong, { type: "pong", id: "p9" });
});

test("malformed input fails closed with ProtocolError", () => {
  assert.throws(() => decodeUplink("not json"), ProtocolError);
  assert.throws(() => decodeUplink(JSON.stringify({ type: "nope" })), ProtocolError);
  assert.throws(() => decodeUplink(JSON.stringify({ type: "hello" })), ProtocolError);
  assert.throws(
    () =>
      decodeUplink(
        JSON.stringify({ type: "hello", device_id: "d", platform: "ios", capabilities: [] }),
      ),
    ProtocolError,
  );
  assert.throws(
    () => decodeUplink(JSON.stringify({ type: "ack", id: "a", ok: "yes" })),
    ProtocolError,
  );
});

test("describeMessage never leaks the relay token (gate 5)", () => {
  const fakeSecret = "SECRET-TOKEN-XYZ-123";
  const msg = decodeUplink(
    JSON.stringify({
      type: "hello",
      device_id: "d1",
      platform: "android",
      model: "Mock",
      width: 1080,
      height: 2400,
      density_dpi: 420,
      capabilities: [],
      token: fakeSecret,
    }),
  );
  const line = describeMessage(msg);
  assert.ok(!line.includes(fakeSecret), `token leaked into log line: ${line}`);
  assert.ok(line.includes("token=present"), "presence must still be indicated");
});
