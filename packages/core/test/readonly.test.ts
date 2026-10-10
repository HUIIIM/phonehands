// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)
// Read-only build assertions. Runs ONLY against a build produced with
// PHONEHANDS_READ_ONLY=1 (`npm run test:readonly`).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ActionNotRegisteredError } from "../src/errors.ts";
import { ActionRegistry } from "../src/registry.ts";
import { Router } from "../src/router.ts";
import { deviceBackend } from "./_helpers.ts";

describe("read-only build: write actions do not exist (compile-time, not runtime)", () => {
  it("registry is in read-only mode", () => {
    const registry = new ActionRegistry();
    assert.equal(registry.readOnly, true);
  });

  it("write actions are absent from the registry", () => {
    const registry = new ActionRegistry();
    for (const action of ["tap", "tap_text", "swipe", "type_text"]) {
      assert.equal(registry.hasAction(action), false, action);
    }
    for (const action of ["observe", "read", "screenshot", "launch_app", "press_home"]) {
      assert.equal(registry.hasAction(action), true, action);
    }
  });

  it("importing write-actions throws immediately", async () => {
    await assert.rejects(
      () => import("../src/write-actions.ts"),
      /read-only build/i
    );
  });

  it("dispatching a write action fails as not-registered (nothing to intercept)", async () => {
    const registry = new ActionRegistry();
    registry.registerBackend(deviceBackend("ios"));
    const router = new Router({ registry });
    await assert.rejects(
      () => router.dispatch("a", "tap", { x: 1, y: 2 }, { deviceType: "ios" }),
      (e: unknown) => e instanceof ActionNotRegisteredError
    );
  });

  it("read actions still route normally", async () => {
    const registry = new ActionRegistry();
    const { apiBackend } = await import("./_helpers.ts");
    const api = apiBackend();
    registry.registerBackend(api);
    const router = new Router({ registry });
    const r = await router.dispatch("a", "read");
    assert.equal(r.ok, true);
    assert.equal(r.backend, "api");
  });
});
