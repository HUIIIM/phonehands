// SPDX-License-Identifier: BUSL-1.1

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPhoneHeaders,
  buildUserAgent,
  newDeviceIds,
  validateLocale,
  type FingerprintConfig,
} from "../src/fingerprint.ts";

function cfg(overrides: Partial<FingerprintConfig> = {}): FingerprintConfig {
  return {
    appSlug: "TestApp",
    appVersion: "1.0.0",
    buildNumber: "100",
    cfNetworkVersion: "3859.100.1",
    darwinVersion: "25.0.0",
    deviceModelCode: "iPhone15,2",
    devicePlatform: "iOS",
    osVersion: "26.0",
    locale: { language: "en-US", region: "US" },
    ...overrides,
  };
}

test("locale is parameterized: headers carry the caller-supplied region/language", () => {
  const headers = buildPhoneHeaders(cfg({ locale: { language: "fr-FR", region: "FR" } }), newDeviceIds());
  assert.equal(headers["x-device-region"], "FR");
  assert.equal(headers["accept-language"], "fr-FR");
});

test("missing locale is refused (the IN/en-GB anti-pattern)", () => {
  const bad = cfg();
  (bad as unknown as { locale: { language: string; region: string } }).locale = { language: "", region: "" };
  assert.throws(() => buildPhoneHeaders(bad, newDeviceIds()), /locale/i);
  assert.throws(() => validateLocale({ language: "", region: "US" }), /locale/i);
});

test("device triple is re-randomized on every login (three fresh UUIDs)", () => {
  const a = newDeviceIds();
  const b = newDeviceIds();
  assert.notEqual(a.deviceId, b.deviceId);
  assert.notEqual(a.installId, b.installId);
  assert.notEqual(a.sessionId, b.sessionId);
  for (const id of [a.deviceId, a.installId, a.sessionId]) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }
});

test("user-agent carries the platform network-stack fingerprint", () => {
  const ua = buildUserAgent(cfg());
  assert.equal(ua, "TestApp/100 CFNetwork/3859.100.1 Darwin/25.0.0");
});

test("headers include device triple + business headers, no secrets when no token", () => {
  const ids = newDeviceIds();
  const headers = buildPhoneHeaders(cfg(), ids);
  assert.equal(headers["x-device-id"], ids.deviceId);
  assert.equal(headers["x-install-id"], ids.installId);
  assert.equal(headers["x-session-id"], ids.sessionId);
  assert.equal(headers["x-device-model-code"], "iPhone15,2");
  assert.equal(headers["x-app-version"], "1.0.0");
  assert.ok(!("authorization" in headers));
  const withToken = buildPhoneHeaders(cfg(), ids, "sekret");
  assert.equal(withToken["authorization"], "Bearer sekret");
});
