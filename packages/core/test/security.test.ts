// SPDX-License-Identifier: MIT
// Security gate tests for @phonehands/core:
//  - MIT SPDX header present on every .ts file; no leftover BUSL/BSL identifier
//    (licence changed BSL 1.1 -> MIT by owner ruling 2026-10-31)
//  - core opens no network sockets: no network module imports in src
//    (loopback-only posture — the device link lives in device-backend,
//    core itself is transport-free by construction)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const HEADER = "// SPDX-License-Identifier: MIT";
// Built from parts so this file's own source never matches it.
const STALE_LICENSE = new RegExp(["SPDX-License-Identifier:\\s*BUSL", "Business" + " Source License"].join("|"), "i");
const PKG_ROOT = path.join(import.meta.dirname, "..");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...tsFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("security: license headers", () => {
  it("every .ts file carries the MIT header and none still carry BUSL", () => {
    const files = [...tsFiles(path.join(PKG_ROOT, "src")), ...tsFiles(path.join(PKG_ROOT, "test"))];
    assert.ok(files.length > 0, "expected to find .ts files");
    const missing: string[] = [];
    const stale: string[] = [];
    for (const file of files) {
      const first = fs.readFileSync(file, "utf8").split("\n")[0];
      if (first.trim() !== HEADER) missing.push(path.relative(PKG_ROOT, file));
      if (STALE_LICENSE.test(fs.readFileSync(file, "utf8"))) {
        stale.push(path.relative(PKG_ROOT, file));
      }
    }
    assert.deepEqual(missing, [], "files missing the MIT header");
    assert.deepEqual(stale, [], "files still carrying a BUSL identifier (licence is MIT)");
  });
});

describe("security: core is transport-free (loopback-only posture)", () => {
  it("no network module imports anywhere in src", () => {
    const files = tsFiles(path.join(PKG_ROOT, "src"));
    const offenders: string[] = [];
    const pattern =
      /(?:require\s*\(\s*|from\s+)["'](?:node:)?(?:net|http|https|http2|dgram|tls|dns|ws)["']|node:(?:net|http|https|dgram|tls)|\bfetch\s*\(|\bWebSocket\s*\(/;
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      // ignore the line that documents the pattern itself (this file is test/)
      if (pattern.test(content)) offenders.push(path.relative(PKG_ROOT, file));
    }
    assert.deepEqual(offenders, [], "core/src must not import network transports");
  });
});
