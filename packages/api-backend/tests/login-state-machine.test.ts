// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThrottledHttpClient } from "../src/http-client.ts";
import { LoginStateMachine, EmailChallengeRequired } from "../src/login-state-machine.ts";
import { SessionStore } from "../src/session-store.ts";
import { newDeviceIds, type FingerprintConfig } from "../src/fingerprint.ts";
import { startTestServer, type Handler } from "./support.ts";

const FP: FingerprintConfig = {
  appSlug: "TestApp",
  appVersion: "1.0.0",
  buildNumber: "100",
  cfNetworkVersion: "3859.100.1",
  darwinVersion: "25.0.0",
  deviceModelCode: "iPhone15,2",
  devicePlatform: "iOS",
  osVersion: "26.0",
  locale: { language: "en-US", region: "US" },
};

/** Mock auth server: install/initiate/submit + 412 email-challenge path. */
const authHandler: Handler = (req) => {
  if (req.url === "/identity/install" && req.method === "POST") return { status: 200, body: { ok: true } };
  if (req.url === "/auth/sms/v2/initiate" && req.method === "POST") return { status: 200, body: { ok: true } };
  if (req.url === "/auth/sms/v2" && req.method === "POST") {
    const body = req.body as Record<string, unknown>;
    if (body["otp"] === "999999") {
      return { status: 412, body: { caseId: "case-123", email: "user@example.com" } };
    }
    if (body["otp"] === "123456") {
      return { status: 200, body: { authToken: "token-sms-ok" } };
    }
    return { status: 401, body: { error: "bad otp" } };
  }
  if (req.url === "/auth/device/validate" && req.method === "POST") {
    const body = req.body as Record<string, unknown>;
    if (body["caseId"] === "case-123" && body["code"] === "111111") {
      return { status: 200, body: { authToken: "token-email-ok" } };
    }
    return { status: 401, body: { error: "bad code" } };
  }
  return { status: 404, body: { error: "not found" } };
};

function makeMachine(serverUrl: string) {
  const dir = mkdtempSync(join(tmpdir(), "phonehands-login-test-"));
  const store = new SessionStore("testapp", dir);
  const client = new ThrottledHttpClient(serverUrl, FP, newDeviceIds(), { minIntervalMs: 0, logger: () => {} });
  return new LoginStateMachine(client, store, FP, newDeviceIds());
}

test("full flow: install -> initiate -> submitOtp -> authenticated + persisted", async () => {
  const server = await startTestServer(authHandler);
  try {
    const m = makeMachine(server.url);
    assert.equal(m.currentState(), "logged_out");
    // status() is local-only: must not hit the network.
    assert.deepEqual(m.status(), { loggedIn: false, state: "logged_out", phoneNumber: null });
    const before = server.requests.length;

    await m.install();
    assert.equal(m.currentState(), "installed");
    await m.initiate("+10000000000");
    assert.equal(m.currentState(), "challenge_sent");
    await m.submitOtp("+10000000000", "123456");
    assert.equal(m.currentState(), "authenticated");
    assert.equal(m.getAuthToken(), "token-sms-ok");
    assert.ok(server.requests.length > before);
  } finally {
    await server.close();
  }
});

test("session persistence: token is restored from disk by a new machine", async () => {
  const server = await startTestServer(authHandler);
  try {
    const dir = mkdtempSync(join(tmpdir(), "phonehands-login-test-"));
    const store = new SessionStore("testapp", dir);
    const client = new ThrottledHttpClient(server.url, FP, newDeviceIds(), { minIntervalMs: 0, logger: () => {} });
    const m = new LoginStateMachine(client, store, FP, newDeviceIds());
    await m.initiate("+10000000000");
    await m.submitOtp("+10000000000", "123456");

    const m2 = new LoginStateMachine(client, store, FP, newDeviceIds());
    assert.equal(m2.currentState(), "authenticated");
    assert.equal(m2.getAuthToken(), "token-sms-ok");
    assert.deepEqual(m2.status(), { loggedIn: true, state: "authenticated", phoneNumber: "+10000000000" });
  } finally {
    await server.close();
  }
});

test("412 becomes a first-class EmailChallengeRequired; email path authenticates", async () => {
  const server = await startTestServer(authHandler);
  try {
    const m = makeMachine(server.url);
    await m.initiate("+10000000000");
    await assert.rejects(() => m.submitOtp("+10000000000", "999999"), (err: unknown) => {
      assert.ok(err instanceof EmailChallengeRequired);
      assert.equal((err as EmailChallengeRequired).caseId, "case-123");
      // The email in the error is never the raw server string in the message (masked).
      assert.ok(!(err as Error).message.includes("user@example.com"));
      return true;
    });
    assert.equal(m.currentState(), "email_challenge");
    await m.submitEmailChallenge("case-123", "111111");
    assert.equal(m.currentState(), "authenticated");
    assert.equal(m.getAuthToken(), "token-email-ok");
  } finally {
    await server.close();
  }
});

test("initiate() is destructive: previous session is cleared before the new challenge", async () => {
  const server = await startTestServer(authHandler);
  try {
    const dir = mkdtempSync(join(tmpdir(), "phonehands-login-test-"));
    const store = new SessionStore("testapp", dir);
    const client = new ThrottledHttpClient(server.url, FP, newDeviceIds(), { minIntervalMs: 0, logger: () => {} });
    const m = new LoginStateMachine(client, store, FP, newDeviceIds());
    await m.initiate("+10000000000");
    await m.submitOtp("+10000000000", "123456");
    assert.equal(m.status().loggedIn, true);

    await m.initiate("+19999999999"); // re-login: old session must die first
    assert.equal(m.status().loggedIn, false);
    assert.equal(m.currentState(), "challenge_sent");
    assert.equal(store.load(), null);
  } finally {
    await server.close();
  }
});

test("logout clears the session AND rotates the device triple", async () => {
  const server = await startTestServer(authHandler);
  try {
    const dir = mkdtempSync(join(tmpdir(), "phonehands-login-test-"));
    const store = new SessionStore("testapp", dir);
    const client = new ThrottledHttpClient(server.url, FP, newDeviceIds(), { minIntervalMs: 0, logger: () => {} });
    const m = new LoginStateMachine(client, store, FP, newDeviceIds());
    await m.initiate("+10000000000");
    await m.submitOtp("+10000000000", "123456");
    const idsBefore = m.getDeviceIds();
    await m.logout();
    assert.equal(m.currentState(), "logged_out");
    assert.equal(store.load(), null);
    const idsAfter = m.getDeviceIds();
    assert.notEqual(idsAfter.deviceId, idsBefore.deviceId);
  } finally {
    await server.close();
  }
});
