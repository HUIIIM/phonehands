// SPDX-License-Identifier: BUSL-1.1

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEVICE_CAPABILITIES,
  CORE_ACTION_TO_DEVICE,
  canHandle,
  capabilityFor,
} from "../src/index.ts";

describe("capability declaration", () => {
  it("declares exactly tap/swipe/type/observe/screenshot", () => {
    assert.deepEqual([...DEVICE_CAPABILITIES], [
      "tap",
      "swipe",
      "type",
      "observe",
      "screenshot",
    ]);
  });

  it("Router lookup: core tap/swipe/type/observe/screenshot resolve", () => {
    assert.equal(canHandle("tap"), true);
    assert.equal(canHandle("swipe"), true);
    assert.equal(canHandle("type"), true);
    assert.equal(canHandle("observe"), true);
    assert.equal(canHandle("screenshot"), true);
    assert.equal(capabilityFor("tap_text"), "tap");
    assert.equal(capabilityFor("type_text"), "type");
    assert.equal(capabilityFor("read"), "observe");
  });

  it("unsupported core actions resolve to null (Router must look elsewhere)", () => {
    assert.equal(capabilityFor("launch_app"), null);
    assert.equal(capabilityFor("press_home"), null);
    assert.equal(canHandle("launch_app"), false);
    assert.equal(canHandle("nonsense_action"), false);
  });

  it("mapping table covers every declared capability", () => {
    const mapped = new Set(Object.values(CORE_ACTION_TO_DEVICE));
    for (const cap of DEVICE_CAPABILITIES) {
      assert.ok(mapped.has(cap), `capability ${cap} missing from mapping table`);
    }
  });
});
