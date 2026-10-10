// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)
// Audit log with defense-in-depth secret redaction.
//
// Primary rule (MV421 / 立项书 §3.4): secrets NEVER enter logs —
// auth-handoff records only { wallType, at }. This module is the second
// line: anything that slips through with a credential-shaped key is
// redacted before it is written.

export interface AuditEntry {
  at: string;
  kind: string;
  accountId?: string;
  detail: unknown;
}

/** Keys whose VALUES are treated as secrets and redacted. */
const SECRET_KEY_PATTERN = /password|passwd|secret|token|otp|credential|session|authcode|private/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-clone `value`, replacing secret-shaped values with "[REDACTED]". */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(redactSecrets) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSecrets(val);
    }
    return out as T;
  }
  return value;
}

export interface AuditLogOptions {
  /** Where JSONL lines go. Default: in-memory only (tests + embedding hosts). */
  sink?: (line: string) => void;
}

export class AuditLog {
  private readonly entries: AuditEntry[] = [];
  private readonly sink?: (line: string) => void;

  constructor(options: AuditLogOptions = {}) {
    this.sink = options.sink;
  }

  append(kind: string, detail: unknown, accountId?: string): AuditEntry {
    const entry: AuditEntry = {
      at: new Date().toISOString(),
      kind,
      accountId,
      detail: redactSecrets(detail),
    };
    this.entries.push(entry);
    this.sink?.(JSON.stringify(entry));
    return entry;
  }

  /** In-memory entries (for tests and host inspection). */
  all(): readonly AuditEntry[] {
    return this.entries;
  }
}
