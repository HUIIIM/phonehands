// SPDX-License-Identifier: BUSL-1.1
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ACTION_PRIVILEGE, ALL_ACTION_NAMES, WRITE_ACTION_NAMES } from "../src/actions.ts";

describe("actions: frozen contract", () => {
  it("exposes exactly the 9 frozen action names", () => {
    assert.deepEqual(
      [...ALL_ACTION_NAMES].sort(),
      ["launch_app", "observe", "press_home", "read", "screenshot", "swipe", "tap", "tap_text", "type_text"]
    );
  });

  it("write-action gate list is exactly tap/tap_text/swipe/type_text", () => {
    assert.deepEqual([...WRITE_ACTION_NAMES].sort(), ["swipe", "tap", "tap_text", "type_text"]);
  });

  it("privilege tiers: reads are read-tier, everything else write-tier", () => {
    assert.equal(ACTION_PRIVILEGE.observe, "read");
    assert.equal(ACTION_PRIVILEGE.read, "read");
    assert.equal(ACTION_PRIVILEGE.screenshot, "read");
    for (const name of ALL_ACTION_NAMES) {
      if (!["observe", "read", "screenshot"].includes(name)) {
        assert.equal(ACTION_PRIVILEGE[name], "write", name);
      }
    }
  });
});
