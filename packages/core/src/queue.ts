// SPDX-License-Identifier: BUSL-1.1
// Single serial operation queue (hinge-mcp P5).
//
// - One account's operations run strictly serially (per-account promise tail).
// - Pending (not yet started) ops per account are capped at 32; over the
//   cap the caller gets QUEUE_FULL and must back off — no silent drop.
// - Every op has its own deadline (default 30s). A deadline breach rejects
//   with TIMEOUT_UNKNOWN: the outcome is UNKNOWN (the tap may or may not
//   have landed). Per MV427 the queue NEVER auto-replays submit-kind
//   actions; callers must "check first, then act".
// - pause()/resume()/abandon() are driven by auth-handoff: while an auth
//   wall is up, the account's queue holds; on resume it continues, on
//   abandon (auth timeout) waiting ops are released with
//   `abandoned:auth_timeout` and the queue unblocks (no deadlock).

import { AuthTimeoutError, QueueFullError, TimeoutUnknownError } from "./errors.ts";

export const DEFAULT_MAX_PENDING = 32;
export const DEFAULT_DEADLINE_MS = 30_000;

interface Gate {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: Error) => void;
}

function createGate(): Gate {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Swallow unhandled rejection until someone awaits the gate.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

export interface EnqueueOptions {
  /** Per-op deadline in ms (default 30s). */
  deadlineMs?: number;
}

export class SerialOpQueue {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly waiting = new Map<string, number>();
  private readonly gates = new Map<string, Gate>();
  private readonly maxPending: number;
  private readonly defaultDeadlineMs: number;

  constructor(options: { maxPending?: number; defaultDeadlineMs?: number } = {}) {
    this.maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
    this.defaultDeadlineMs = options.defaultDeadlineMs ?? DEFAULT_DEADLINE_MS;
  }

  /** Number of ops enqueued but not yet started for an account. */
  pendingCount(accountId: string): number {
    return this.waiting.get(accountId) ?? 0;
  }

  enqueue<T>(accountId: string, op: () => Promise<T>, options: EnqueueOptions = {}): Promise<T> {
    const waiting = this.waiting.get(accountId) ?? 0;
    if (waiting >= this.maxPending) {
      return Promise.reject(new QueueFullError(accountId, this.maxPending));
    }
    this.waiting.set(accountId, waiting + 1);

    const prev = this.tails.get(accountId) ?? Promise.resolve();
    const deadlineMs = options.deadlineMs ?? this.defaultDeadlineMs;
    // Capture the pause gate at enqueue time AND re-check at await time:
    // a pause may land while this op waits on its predecessor, and an
    // abandon may settle+remove the gate before this op reaches it.
    // Awaiting a settled gate is safe: rejected -> throws, resolved -> passes.
    const enqueuedGate = this.gates.get(accountId) ?? null;
    let started = false;

    const run: Promise<T> = (async () => {
      try {
        await prev; // serial per account
        const gate = this.gates.get(accountId) ?? enqueuedGate;
        if (gate) {
          await gate.promise; // auth-handoff pause point; throws on abandon
        }
        started = true;
        this.decrementWaiting(accountId);
        return await this.withDeadline(accountId, op, deadlineMs);
      } catch (err) {
        if (!started) this.decrementWaiting(accountId);
        throw err;
      }
    })();

    // Keep the tail alive regardless of this op's outcome.
    this.tails.set(
      accountId,
      run.then(
        () => undefined,
        () => undefined
      )
    );
    return run;
  }

  /** Pause an account's queue (auth wall up): new ops wait for resume/abandon. */
  pause(accountId: string): void {
    if (!this.gates.has(accountId)) {
      this.gates.set(accountId, createGate());
    }
  }

  /** Resume an account's queue (human completed the auth wall). */
  resume(accountId: string): void {
    const gate = this.gates.get(accountId);
    if (gate) {
      this.gates.delete(accountId);
      gate.resolve();
    }
  }

  /**
   * Release an account's queue after abandonment (e.g. auth timeout).
   * Waiting ops reject with `reason`; the queue unblocks — no deadlock.
   */
  abandon(accountId: string, reason: string): void {
    const gate = this.gates.get(accountId);
    if (gate) {
      this.gates.delete(accountId);
      gate.reject(new AuthTimeoutError(`${accountId}: ${reason}`));
    }
  }

  private decrementWaiting(accountId: string): void {
    const waiting = this.waiting.get(accountId) ?? 0;
    this.waiting.set(accountId, Math.max(0, waiting - 1));
  }

  private withDeadline<T>(accountId: string, op: () => Promise<T>, deadlineMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new TimeoutUnknownError(accountId, deadlineMs));
      }, deadlineMs);
      // Deliberately NOT unref'd: the deadline is part of the contract
      // (TIMEOUT_UNKNOWN must fire). The timer is cleared as soon as the op
      // settles, so it only keeps the process alive while an op is pending.
      op().then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }
}
