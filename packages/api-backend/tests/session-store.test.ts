// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { SessionStore, SessionCorruptError, SessionInsecureError, type StoredSession } from "../src/session-store.ts";
import { newDeviceIds } from "../src/fingerprint.ts";

function makeStore(): { store: SessionStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "phonehands-session-test-"));
  return { store: new SessionStore("testapp", dir), dir };
}

function sample(): StoredSession {
  return {
    version: 1,
    app: "testapp",
    deviceIds: newDeviceIds(),
    authToken: "super-secret-token",
    phoneNumber: "+10000000000",
    savedAt: new Date().toISOString(),
  };
}

test("roundtrip: save then load returns the same session", () => {
  const { store } = makeStore();
  const s = sample();
  store.save(s);
  const loaded = store.load();
  assert.deepEqual(loaded, s);
});

test("file has 0600 permissions and no temp file is left behind", () => {
  const { store, dir } = makeStore();
  store.save(sample());
  const mode = statSync(store.filePath).mode & 0o777;
  assert.equal(mode, 0o600);
  const leftovers = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
});

test("parent directory is 0700", () => {
  const { store, dir } = makeStore();
  store.save(sample());
  assert.equal(statSync(dir).mode & 0o777, 0o700);
});

test("corrupt JSON fails loudly with SessionCorruptError (never silently repaired)", () => {
  const { store } = makeStore();
  writeFileSync(store.filePath, "{ not json", { mode: 0o600 });
  assert.throws(() => store.load(), SessionCorruptError);
});

test("schema-violating content fails loudly (e.g. missing authToken shape)", () => {
  const { store } = makeStore();
  writeFileSync(store.filePath, JSON.stringify({ version: 1, app: "testapp" }), { mode: 0o600 });
  assert.throws(() => store.load(), SessionCorruptError);
});

test("load returns null when no session exists", () => {
  const { store } = makeStore();
  assert.equal(store.load(), null);
});

test("clear removes the session file", () => {
  const { store } = makeStore();
  store.save(sample());
  store.clear();
  assert.equal(store.load(), null);
});

test("overly broad permissions refuse to load (T2 strict gate, stricter than 0600 creation)", async () => {
  const { chmodSync } = await import("node:fs");
  const { store } = makeStore();
  store.save(sample());
  chmodSync(store.filePath, 0o644);
  assert.throws(() => store.load(), SessionInsecureError);
  chmodSync(store.filePath, 0o640);
  assert.throws(() => store.load(), SessionInsecureError);
});

test("app slug is restricted so the session path cannot escape baseDir", () => {
  assert.throws(() => new SessionStore("../evil", tmpdir()), /invalid app slug/i);
  assert.throws(() => new SessionStore("a/b", tmpdir()), /invalid app slug/i);
});
