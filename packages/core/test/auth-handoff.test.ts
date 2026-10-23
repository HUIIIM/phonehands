// SPDX-License-Identifier: BUSL-1.1
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuditLog } from "../src/audit.ts";
import { AuthHandoff, DEFAULT_RESUME_TIMEOUT_MS } from "../src/auth-handoff.ts";
import type { AuthRequiredEvent } from "../src/auth-handoff.ts";
import { SerialOpQueue } from "../src/queue.ts";

const FAKE_PASSWORD = "F4KE-P@ss-handoff-TEST-DO-NOT-USE";

function captureStderr() {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  (process.stderr.write as unknown as (chunk: string) => boolean) = (chunk: string) => {
    chunks.push(String(chunk));
    return true;
  };
  return {
    chunks,
    restore() {
      process.stderr.write = original as typeof process.stderr.write;
    },
  };
}

describe("auth-handoff: pause -> resume", () => {
  it("IDLE -> PAUSED -> RESUMED; queued op continues after resume", async () => {
    const queue = new SerialOpQueue();
    const handoff = new AuthHandoff({ queue, resumeTimeoutMs: 5000 });
    const events: AuthRequiredEvent[] = [];
    handoff.onAuthRequired((e) => events.push(e));

    assert.equal(handoff.state("acct1"), "IDLE");
    handoff.raise("acct1", "face_id");

    assert.equal(handoff.state("acct1"), "PAUSED");
    assert.equal(events.length, 1);
    assert.equal(events[0].accountId, "acct1");
    assert.equal(events[0].wallType, "face_id");
    assert.ok(events[0].at);

    let ran = false;
    const p = queue.enqueue("acct1", async () => {
      ran = true;
      return "continued";
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(ran, false, "queue must hold while paused");

    handoff.resume("acct1");
    assert.equal(handoff.state("acct1"), "RESUMED");
    assert.equal(await p, "continued");
    assert.equal(ran, true);
  });

  it("default resume timeout is 15 minutes", () => {
    assert.equal(DEFAULT_RESUME_TIMEOUT_MS, 15 * 60 * 1000);
  });
});

describe("auth-handoff: timeout releases the queue (no deadlock)", () => {
  it("ABANDONED after timeout; waiting ops rejected; queue usable again", async () => {
    const queue = new SerialOpQueue();
    const handoff = new AuthHandoff({ queue, resumeTimeoutMs: 60 });
    handoff.raise("acct2", "otp_sms");

    const p = queue.enqueue("acct2", async () => "never");
    await assert.rejects(
      p,
      (e: unknown) => e instanceof Error && (e as { code?: string }).code === "abandoned:auth_timeout"
    );
    // give the timer a beat to settle state
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(handoff.state("acct2"), "ABANDONED");
    assert.equal(await queue.enqueue("acct2", async () => "alive"), "alive");
  });
});

describe("auth-handoff: credentials never enter logs or evidence", () => {
  it("a fake password fed through the evidence path leaves zero residue", () => {
    const lines: string[] = [];
    const audit = new AuditLog({ sink: (line) => lines.push(line) });
    const queue = new SerialOpQueue();
    const handoff = new AuthHandoff({ queue, resumeTimeoutMs: 5000, audit });
    const cap = captureStderr();
    try {
      // The backend attached credential material to the handoff; the handoff
      // must discard it entirely.
      handoff.raise("acct3", "password", { password: FAKE_PASSWORD, otp: FAKE_PASSWORD });
      handoff.resume("acct3");
    } finally {
      cap.restore();
    }
    const allText = [...lines, ...cap.chunks, ...audit.all().map((e) => JSON.stringify(e))].join("\n");
    assert.ok(!allText.includes(FAKE_PASSWORD), "credential leaked into log/audit/stderr");
    // evidence recorded is exactly { wallType, at } — nothing else
    const required = audit.all().find((e) => e.kind === "auth.required");
    assert.ok(required);
    assert.deepEqual(Object.keys(required.detail as object).sort(), ["at", "wallType"]);
  });

  it("redactSecrets strips credential-shaped keys at any depth", () => {
    const audit = new AuditLog();
    const entry = audit.append("probe", {
      password: "p",
      nested: { sessionToken: "t", ok: 1 },
      list: [{ otp: "o" }],
      benign: "fine",
    });
    const detail = entry.detail as Record<string, unknown>;
    assert.equal(detail.password, "[REDACTED]");
    assert.equal((detail.nested as Record<string, unknown>).sessionToken, "[REDACTED]");
    assert.equal((detail.nested as Record<string, unknown>).ok, 1);
    assert.equal(((detail.list as unknown[])[0] as Record<string, unknown>).otp, "[REDACTED]");
    assert.equal(detail.benign, "fine");
  });
});
