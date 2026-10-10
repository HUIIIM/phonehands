// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResultValidationError } from "../src/errors.ts";
import { validateResult } from "../src/types.ts";
import type { ActionResult } from "../src/types.ts";
import { okResult } from "./_helpers.ts";

describe("envelope: devicePlatform contract", () => {
  it("api envelope without devicePlatform is valid", () => {
    const r: ActionResult = okResult({ backend: "api" });
    delete (r as Partial<ActionResult>).devicePlatform;
    validateResult(r);
  });

  it("device envelope missing devicePlatform throws RESULT_VALIDATION", () => {
    const r: ActionResult = okResult({ backend: "device" });
    delete (r as Partial<ActionResult>).devicePlatform;
    assert.throws(() => validateResult(r), (e: unknown) => e instanceof ResultValidationError);
  });

  it("device envelope with ios/android passes", () => {
    validateResult(okResult({ backend: "device", devicePlatform: "ios" }));
    validateResult(okResult({ backend: "device", devicePlatform: "android" }));
  });

  it("api envelope carrying devicePlatform throws RESULT_VALIDATION", () => {
    const r: ActionResult = okResult({ backend: "api", devicePlatform: "ios" });
    assert.throws(() => validateResult(r), (e: unknown) => e instanceof ResultValidationError);
  });

  it("envelope carries the 5 required fields", () => {
    const r = okResult();
    for (const field of ["ok", "backend", "latency_ms", "degraded", "evidence"] as const) {
      assert.ok(field in r, field);
    }
    assert.equal(typeof r.latency_ms, "number");
    assert.equal(typeof r.degraded, "boolean");
  });
});
