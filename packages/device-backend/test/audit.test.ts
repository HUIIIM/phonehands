// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  recordAudit,
  getAuditLog,
  clearAuditLog,
  setAuditSink,
} from "../src/index.ts";

describe("audit log redaction", () => {
  it("entries carry no sensitive fields", () => {
    clearAuditLog();
    setAuditSink(null);
    recordAudit("tap", {
      ok: true,
      backend: "device",
      latency_ms: 12,
      degraded: false,
      evidence: { action: "tap", attempted: { x: 100, y: 200 } },
    });
    const log = getAuditLog();
    assert.equal(log.length, 1);
    const entry = log[0] as unknown as Record<string, unknown>;
    assert.deepEqual(Object.keys(entry).sort(), [
      "action",
      "degraded",
      "latency_ms",
      "ok",
      "ts",
    ]);
    // Coordinates must not leak into the audit trail.
    assert.equal(JSON.stringify(entry).includes("100"), false);
  });
});
