// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/**
 * Shared types for the phonehands API engine.
 *
 * The result envelope mirrors @phonehands/core so any router can treat both
 * engines uniformly: every call says who executed it, how long it took,
 * and whether it ran in a degraded state.
 */

/** The API engine always identifies itself as "api" in envelopes. */
export type BackendKind = "api";

export interface ApiCallError {
  /** Machine-readable code, e.g. "HTTP_403", "RATE_LIMITED", "NOT_LOGGED_IN". */
  code: string;
  /** Human-readable message. Must never contain secrets (see redact.ts). */
  message: string;
  httpStatus?: number;
}

/**
 * Unified result envelope returned by every API-backend call.
 * T is the structured payload (reads) or null on failure.
 */
export interface ApiEnvelope<T = unknown> {
  ok: boolean;
  backend: BackendKind;
  latency_ms: number;
  /** True when the call succeeded only after retry/backoff, or while the
   *  backend health probe marks this engine as degraded. */
  degraded: boolean;
  evidence: T | null;
  error?: ApiCallError;
}

export interface PageParams {
  limit?: number;
  cursor?: string | null;
  /** Test/mock only: force a fault. Shape: "__fault=403" or "__fault=429". */
  fault?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
