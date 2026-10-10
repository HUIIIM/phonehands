// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adbFailure,
  launchCommand,
  screenshotCommand,
  swipeCommand,
  tapCommand,
} from "../src/wireless-adb.ts";

const T = { serial: "192.168.1.42:5555" };

test("tap command shape", () => {
  assert.deepEqual(tapCommand(T, 540, 1200), [
    "adb", "-s", "192.168.1.42:5555", "shell", "input", "tap", "540", "1200",
  ]);
});

test("swipe command shape", () => {
  assert.deepEqual(swipeCommand(T, 100, 200, 300, 400, 300), [
    "adb", "-s", "192.168.1.42:5555", "shell", "input", "swipe",
    "100", "200", "300", "400", "300",
  ]);
});

test("screenshot uses exec-out screencap (PNG to stdout)", () => {
  assert.deepEqual(screenshotCommand(T), [
    "adb", "-s", "192.168.1.42:5555", "exec-out", "screencap", "-p",
  ]);
});

test("launch uses monkey with the package", () => {
  const cmd = launchCommand(T, "com.example.app");
  assert.ok(cmd.includes("com.example.app"));
  assert.ok(cmd.includes("monkey"));
});

test("adbFailure envelope: degraded, backend=device, android", () => {
  const e = adbFailure("tap", "device offline");
  assert.equal(e.ok, false);
  assert.equal(e.backend, "device");
  assert.equal(e.devicePlatform, "android");
  assert.equal(e.degraded, true);
  assert.equal(e.evidence.fallback, "wireless-adb");
});
