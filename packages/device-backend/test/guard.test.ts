// SPDX-License-Identifier: BUSL-1.1

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assertLoopbackHost,
  assertLoopbackUrl,
  DeviceSecurityError,
} from "../src/index.ts";

describe("loopback-only guard", () => {
  it("accepts 127.0.0.1", () => {
    assertLoopbackHost("127.0.0.1");
    assertLoopbackUrl("http://127.0.0.1:8100");
  });

  it("accepts ::1 and localhost", () => {
    assertLoopbackHost("::1");
    assertLoopbackHost("localhost");
    assertLoopbackUrl("http://localhost:8100");
  });

  it("rejects LAN addresses", () => {
    for (const host of ["192.168.1.10", "10.0.0.5", "172.16.0.2"]) {
      assert.throws(() => assertLoopbackHost(host), DeviceSecurityError, host);
    }
  });

  it("rejects public IPs and DNS names", () => {
    for (const host of ["8.8.8.8", "203.0.113.7", "example.com", "wda.internal"]) {
      assert.throws(() => assertLoopbackHost(host), DeviceSecurityError, host);
    }
  });

  it("rejects loopback-range siblings (exact allowlist)", () => {
    assert.throws(() => assertLoopbackHost("127.0.0.2"), DeviceSecurityError);
    assert.throws(() => assertLoopbackHost("127.1"), DeviceSecurityError);
  });

  it("rejects remote URLs at construction time", () => {
    assert.throws(
      () => assertLoopbackUrl("http://192.168.1.10:8100"),
      DeviceSecurityError,
    );
    assert.throws(
      () => assertLoopbackUrl("http://example.com:8100"),
      DeviceSecurityError,
    );
  });

  it("rejects credentials and non-http schemes", () => {
    assert.throws(
      () => assertLoopbackUrl("http://user:pass@127.0.0.1:8100"),
      DeviceSecurityError,
    );
    assert.throws(
      () => assertLoopbackUrl("https://127.0.0.1:8100"),
      DeviceSecurityError,
    );
  });

  it("rejects garbage URLs", () => {
    assert.throws(() => assertLoopbackUrl("not a url"), DeviceSecurityError);
  });
});
