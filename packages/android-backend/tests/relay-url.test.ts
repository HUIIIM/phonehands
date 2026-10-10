// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PORT,
  DEFAULT_RELAY_URL,
  parseRelayUrl,
  relayUrlFromEnv,
  RelayUrlError,
} from "../src/relay-url.ts";

test("default relay URL matches the documented convention", () => {
  assert.equal(relayUrlFromEnv({}), DEFAULT_RELAY_URL);
  const p = parseRelayUrl(DEFAULT_RELAY_URL, {});
  assert.equal(p.scheme, "ws");
  assert.equal(p.host, "127.0.0.1");
  assert.equal(p.port, DEFAULT_PORT);
  assert.equal(p.path, "/phonehands-android");
  assert.equal(p.pathKind, "direct");
});

test("PHONEHANDS_RELAY_URL is honored", () => {
  const env = { PHONEHANDS_RELAY_URL: "wss://relay.example.com:9443/dt" };
  assert.equal(relayUrlFromEnv(env), "wss://relay.example.com:9443/dt");
  const p = parseRelayUrl(relayUrlFromEnv(env), env);
  assert.equal(p.scheme, "wss");
  assert.equal(p.host, "relay.example.com");
  assert.equal(p.port, 9443);
  assert.equal(p.path, "/dt");
});

test("non-ws schemes fail closed", () => {
  assert.throws(() => parseRelayUrl("http://x:9011/", {}), RelayUrlError);
  assert.throws(() => parseRelayUrl("not-a-url", {}), RelayUrlError);
});

test("credentials in the URL are rejected (token goes in hello, not the URL)", () => {
  assert.throws(() => parseRelayUrl("ws://user:pass@127.0.0.1:9011/", {}), RelayUrlError);
});

test("PHONEHANDS_RELAY_PATH overrides inference", () => {
  const env = { PHONEHANDS_RELAY_PATH: "ssh-tunnel" };
  const p = parseRelayUrl("ws://10.0.0.5:9011/dt", env);
  assert.equal(p.pathKind, "ssh-tunnel");
});

test("tailscale hosts are inferred", () => {
  assert.equal(parseRelayUrl("ws://phone.ts.net:9011/dt", {}).pathKind, "tailscale");
  assert.equal(parseRelayUrl("ws://100.64.0.5:9011/dt", {}).pathKind, "tailscale");
});
