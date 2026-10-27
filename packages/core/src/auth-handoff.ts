// SPDX-License-Identifier: BUSL-1.1
// Auth handoff protocol (hinge-mcp P2 spirit, the phonehands queued pause/resume design).
//
// When a backend hits an auth wall (password / Face ID / SMS code screen)
// it returns an envelope with error.code === "AUTH_REQUIRED". The Router
// does NOT retry and does NOT count it as an engine fault — instead it
// raises the handoff:
//
//   IDLE → AUTH_REQUIRED → PAUSED (queue holds, no error, no retry)
//        → RESUMED (human completed the wall; queue continues)
//        → ABANDONED (resume timeout; task marked abandoned:auth_timeout,
//           queue released — never deadlocks)
//
// Credential rule (red line): the framework NEVER touches passwords or
// OTPs. Evidence and audit entries record ONLY { wallType, at }.
// Any credential-shaped value attached to the handoff is discarded and,
// belt-and-braces, redacted by the audit log.

import { AuditLog } from "./audit.ts";
import { SerialOpQueue } from "./queue.ts";
import type { AuthWallType } from "./types.ts";

export type { AuthWallType };

export type HandoffState = "IDLE" | "AUTH_REQUIRED" | "PAUSED" | "RESUMED" | "ABANDONED";

/** Default 15 minutes for a human to complete the auth wall. */
export const DEFAULT_RESUME_TIMEOUT_MS = 15 * 60 * 1000;

export interface AuthRequiredEvent {
  accountId: string;
  wallType: AuthWallType;
  at: string;
}

export type AuthRequiredListener = (event: AuthRequiredEvent) => void;

export interface AuthHandoffOptions {
  queue: SerialOpQueue;
  /** Override the 15-minute default (tests use a short value). */
  resumeTimeoutMs?: number;
  audit?: AuditLog;
}

function defaultNotify(event: AuthRequiredEvent): void {
  // Default notification channel: stderr. Hosts wire their own channel
  // (push, IM, etc.) via onAuthRequired(). No credentials are ever logged.
  process.stderr.write(
    `[phonehands:auth] AUTH_REQUIRED account=${event.accountId} wall=${event.wallType} at=${event.at}\n`
  );
}

export class AuthHandoff {
  private readonly queue: SerialOpQueue;
  private readonly resumeTimeoutMs: number;
  private readonly audit: AuditLog;
  private readonly listeners: AuthRequiredListener[] = [defaultNotify];
  private readonly states = new Map<string, HandoffState>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: AuthHandoffOptions) {
    this.queue = options.queue;
    this.resumeTimeoutMs = options.resumeTimeoutMs ?? DEFAULT_RESUME_TIMEOUT_MS;
    this.audit = options.audit ?? new AuditLog();
  }

  /** Register an additional human-notification channel. */
  onAuthRequired(listener: AuthRequiredListener): void {
    this.listeners.push(listener);
  }

  state(accountId: string): HandoffState {
    return this.states.get(accountId) ?? "IDLE";
  }

  /**
   * Raise the handoff for an account. `evidenceHint` exists ONLY so the
   * no-credential rule is testable: whatever the backend attached is
   * discarded — it never reaches evidence, audit, or listeners.
   */
  raise(accountId: string, wallType: AuthWallType, evidenceHint?: unknown): void {
    // Explicitly discard any attached credential material.
    void evidenceHint;

    const at = new Date().toISOString();
    this.states.set(accountId, "PAUSED");
    // Evidence = wall type + timestamp. Nothing else. Ever.
    this.audit.append("auth.required", { wallType, at }, accountId);
    this.queue.pause(accountId);

    const event: AuthRequiredEvent = { accountId, wallType, at };
    for (const listener of this.listeners) {
      listener(event);
    }
    this.armTimer(accountId);
  }

  /** Human completed the auth wall: release the queue. */
  resume(accountId: string): void {
    this.clearTimer(accountId);
    this.states.set(accountId, "RESUMED");
    this.audit.append("auth.resumed", { at: new Date().toISOString() }, accountId);
    this.queue.resume(accountId);
  }

  private armTimer(accountId: string): void {
    this.clearTimer(accountId);
    const timer = setTimeout(() => this.onTimeout(accountId), this.resumeTimeoutMs);
    // Not unref'd: the resume timeout must fire to release the queue.
    // resume() clears it, so it only lives while an account is paused.
    this.timers.set(accountId, timer);
  }

  private clearTimer(accountId: string): void {
    const timer = this.timers.get(accountId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(accountId);
    }
  }

  private onTimeout(accountId: string): void {
    this.timers.delete(accountId);
    this.states.set(accountId, "ABANDONED");
    this.audit.append(
      "auth.abandoned",
      { reason: "abandoned:auth_timeout", at: new Date().toISOString() },
      accountId
    );
    // Release the queue: waiting ops reject with abandoned:auth_timeout,
    // the gate is removed, and the account can operate again. No deadlock.
    this.queue.abandon(accountId, "abandoned:auth_timeout");
  }
}
