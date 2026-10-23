// SPDX-License-Identifier: BUSL-1.1

/**
 * Audit log for device-backend actions.
 *
 * Redaction discipline (non-negotiable): entries carry ONLY
 * { ts, action, ok, latency_ms, degraded }. No coordinates, no typed
 * text, no tree contents, no screenshot bytes, no session ids.
 * Anything sensitive stays out of the log by construction — there is
 * no field for it.
 */

import type { DeviceEnvelope } from "./types.ts";

export interface AuditEntry {
  ts: string;
  action: string;
  ok: boolean;
  latency_ms: number;
  degraded: boolean;
}

const MAX_ENTRIES = 1000;
const ring: AuditEntry[] = [];
let sink: ((entry: AuditEntry) => void) | null = null;

/** Install an external sink (e.g. file writer). Default: in-memory only. */
export function setAuditSink(fn: ((entry: AuditEntry) => void) | null): void {
  sink = fn;
}

export function recordAudit(action: string, envelope: DeviceEnvelope): void {
  const entry: AuditEntry = {
    ts: new Date().toISOString(),
    action,
    ok: envelope.ok,
    latency_ms: envelope.latency_ms,
    degraded: envelope.degraded,
  };
  ring.push(entry);
  if (ring.length > MAX_ENTRIES) ring.shift();
  sink?.(entry);
}

/** Read-only view of the in-memory audit ring. */
export function getAuditLog(): readonly AuditEntry[] {
  return ring;
}

/** Test/ops helper: clear the ring. */
export function clearAuditLog(): void {
  ring.length = 0;
}
