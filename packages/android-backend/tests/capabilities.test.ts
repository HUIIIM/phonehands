// SPDX-License-Identifier: BUSL-1.1

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANDROID_CAPABILITIES,
  canHandle,
  capabilityFor,
  CORE_ACTION_TO_ANDROID,
  DEVICE_PLATFORM,
} from "../src/capabilities.ts";

test("MVP declares exactly tap/swipe/screenshot/launch/observe", () => {
  assert.deepEqual([...ANDROID_CAPABILITIES], [
    "tap",
    "swipe",
    "screenshot",
    "launch",
    "observe",
  ]);
});

test("core action mapping: supported set", () => {
  assert.ok(canHandle("tap"));
  assert.ok(canHandle("swipe"));
  assert.ok(canHandle("screenshot"));
  assert.ok(canHandle("observe"));
  assert.ok(canHandle("launch_app"));
  assert.equal(capabilityFor("launch_app"), "launch");
});

test("type is Phase 2: fail closed", () => {
  assert.equal(canHandle("type"), false);
  assert.equal(canHandle("type_text"), false);
  assert.equal(canHandle("tap_text"), false);
  assert.equal(canHandle("press_home"), false);
  assert.equal(capabilityFor("type"), null);
});

test("unknown core actions fail closed", () => {
  assert.equal(canHandle("do_anything"), false);
  assert.equal(capabilityFor("do_anything"), null);
});

test("every CORE_ACTION_TO_ANDROID value is a declared capability or null", () => {
  for (const [core, cap] of Object.entries(CORE_ACTION_TO_ANDROID)) {
    if (cap !== null) {
      assert.ok(
        (ANDROID_CAPABILITIES as readonly string[]).includes(cap),
        `${core} -> ${cap} is not declared`,
      );
    }
  }
});

test("platform discriminator is android (Router tells engines apart)", () => {
  assert.equal(DEVICE_PLATFORM, "android");
});
