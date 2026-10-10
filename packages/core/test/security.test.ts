// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)
// Security gate tests for @phonehands/core:
//  - BSL license header present on every .ts file (never MIT)
//  - core opens no network sockets: no network module imports in src
//    (loopback-only posture — the device link lives in device-backend,
//    core itself is transport-free by construction)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const HEADER = "// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)";
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
  it("every .ts file carries the BUSL-1.1 header and none mention MIT", () => {
    const files = [...tsFiles(path.join(PKG_ROOT, "src")), ...tsFiles(path.join(PKG_ROOT, "test"))];
    assert.ok(files.length > 0, "expected to find .ts files");
    const missing: string[] = [];
    const mit: string[] = [];
    for (const file of files) {
      const first = fs.readFileSync(file, "utf8").split("\n")[0];
      if (first.trim() !== HEADER) missing.push(path.relative(PKG_ROOT, file));
      if (/SPDX-License-Identifier:\s*MIT/i.test(fs.readFileSync(file, "utf8"))) {
        mit.push(path.relative(PKG_ROOT, file));
      }
    }
    assert.deepEqual(missing, [], "files missing the BUSL-1.1 header");
    assert.deepEqual(mit, [], "files carrying an MIT identifier (forbidden)");
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
