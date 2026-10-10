// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WRITE_ALLOWLIST_ENV,
  KNOWN_WRITE_TOOLS,
  getEnabledWriteTools,
  parseWriteAllowlist,
  assertWriteEnabled,
  WriteNotEnabledError,
} from "../src/write-tools.ts";

test("default: no write tools enabled (deny by default)", () => {
  assert.deepEqual(parseWriteAllowlist({}), []);
  assert.deepEqual(getEnabledWriteTools({}), []);
  assert.throws(() => assertWriteEnabled("send_message", {}), WriteNotEnabledError);
});

test("allowlist parsing trims and drops empties", () => {
  const env = { [WRITE_ALLOWLIST_ENV]: " send_message ,, like " } as NodeJS.ProcessEnv;
  assert.deepEqual(parseWriteAllowlist(env), ["send_message", "like"]);
});

test("allowlisted-but-unimplemented tools still enable nothing (Phase 1)", () => {
  // Proves the mechanism cannot accidentally open a write surface:
  // even "send_message,like" in the env enables zero tools because none are implemented.
  const env = { [WRITE_ALLOWLIST_ENV]: "send_message,like" } as NodeJS.ProcessEnv;
  assert.deepEqual(getEnabledWriteTools(env), []);
  assert.throws(() => assertWriteEnabled("send_message", env), WriteNotEnabledError);
});

test("error message tells the operator exactly how to enable (explicit, auditable)", () => {
  try {
    assertWriteEnabled("like", {});
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof WriteNotEnabledError);
    assert.ok((err as Error).message.includes(WRITE_ALLOWLIST_ENV));
    assert.ok((err as Error).message.includes("denied by default"));
  }
});

test("Phase 1 registry is intentionally empty", () => {
  assert.deepEqual(KNOWN_WRITE_TOOLS, []);
});
