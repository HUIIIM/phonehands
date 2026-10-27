// SPDX-License-Identifier: BUSL-1.1

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  API_READ_ACTIONS,
  KNOWN_WRITE_ACTIONS,
  assertApiCapable,
  getApiBackendCapabilities,
  isApiCapable,
} from "../src/capabilities.ts";
import { redact, sanitizeLogLine } from "../src/redact.ts";

test("read actions are declared supported", () => {
  assert.ok(API_READ_ACTIONS.includes("likes_received"));
  assert.ok(API_READ_ACTIONS.includes("matches"));
  assert.ok(API_READ_ACTIONS.includes("chat_messages"));
  const table = getApiBackendCapabilities();
  for (const action of API_READ_ACTIONS) {
    assert.equal(table[action].supported, true);
    assertApiCapable(action); // must not throw
    assert.equal(isApiCapable(action), true);
  }
});

test("every known write action is declared UNSUPPORTED (compile-time read-only)", () => {
  const table = getApiBackendCapabilities();
  for (const action of KNOWN_WRITE_ACTIONS) {
    assert.equal(table[action].supported, false);
    assert.throws(() => assertApiCapable(action), /not supported/);
    assert.equal(isApiCapable(action), false);
  }
});

test("unknown actions fail closed", () => {
  assert.equal(isApiCapable("do_anything"), false);
  assert.throws(() => assertApiCapable("do_anything"), /fail closed/);
});

test("redact(): secret-bearing keys are stripped recursively", () => {
  const out = redact({
    user: "alice",
    authToken: "sekret",
    nested: { password: "pw", ok: 1 },
    list: [{ sessionId: "sid" }],
  }) as Record<string, unknown>;
  assert.equal(out["user"], "alice");
  assert.equal(out["authToken"], "[REDACTED]");
  assert.deepEqual(out["nested"], { password: "[REDACTED]", ok: 1 });
  assert.deepEqual(out["list"], [{ sessionId: "[REDACTED]" }]);
});

test("sanitizeLogLine(): bearer tokens and quoted secrets are masked", () => {
  const line = sanitizeLogLine('POST /x authToken="sekret" header Bearer abc.def.ghi');
  assert.ok(!line.includes("sekret"));
  assert.ok(!line.includes("abc.def.ghi"));
  assert.ok(line.includes("[REDACTED]"));
});

test("redact(): cookies, JWTs and phone numbers are stripped too", () => {
  const out = redact({
    cookie: "sid=abc",
    jwt: "eyJhbGciOi.x.y",
    phoneNumber: "+15551234567",
    note: "Authorization: Basic dXNlcjpwYXNz",
  }) as Record<string, unknown>;
  assert.equal(out["cookie"], "[REDACTED]");
  assert.equal(out["jwt"], "[REDACTED]");
  assert.equal(out["phoneNumber"], "[REDACTED]");
  assert.ok(!String(out["note"]).includes("dXNlcjpwYXNz"));
});

test("sanitizeLogLine(): Basic auth and Cookie headers are masked", () => {
  const line = sanitizeLogLine("GET /x Authorization: Basic dXNlcjpwYXNz\nCookie: sid=abc; other=1");
  assert.ok(!line.includes("dXNlcjpwYXNz"));
  assert.ok(!line.includes("sid=abc"));
});
