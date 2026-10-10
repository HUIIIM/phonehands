// MIT License — Copyright (c) 2026 Ehsan
// Adapted from ios_mcp/errors.py and ios_mcp/wda/client.py in
// emazaheri/ios-agent (MIT; full text in packages/device-backend/NOTICE.md,
// license status pending GC final ruling).
//
// phonehands modifications:
//  - Ported to TypeScript (sync node:http transport).
//  - Added ActionTimeout as a DISTINCT error from RunnerCrashed: a request
//    that times out is ambiguous (the device may have executed it) and must
//    NOT be auto-healed+replayed (MV427 "never replay uncertain"). The
//    upstream maps read-timeouts to RunnerCrashed (recoverable); we
//    deliberately diverge here — see src/wda/transport.ts.

/** Machine-readable error codes for the device stack. (const object, not enum: erasable syntax.) */
export const ErrorCode = {
  DEVICE_LOCKED: "device_locked",
  RUNNER_CRASHED: "runner_crashed",
  SESSION_LOST: "session_lost",
  ACTION_TIMEOUT: "action_timeout",
  CONNECTION_LOST: "connection_lost",
  WDA_ERROR: "wda_error",
  ELEMENT_NOT_FOUND: "element_not_found",
  ELEMENT_STALE: "element_stale",
  ELEMENT_NOT_INTERACTABLE: "element_not_interactable",
  UNEXPECTED_ALERT: "unexpected_alert",
  APP_NOT_FOUND: "app_not_found",
  NOT_SUPPORTED: "not_supported",
  INTERNAL: "internal",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface AutomationErrorOptions {
  hint?: string;
  code?: ErrorCode;
  details?: Record<string, unknown>;
  recoverable?: boolean;
}

/** Base class for every error this package raises deliberately. */
export class AutomationError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  readonly details: Record<string, unknown>;
  readonly recoverable: boolean;

  constructor(message: string, options: AutomationErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = options.code ?? ErrorCode.INTERNAL;
    this.hint = options.hint;
    this.details = options.details ?? {};
    this.recoverable = options.recoverable ?? false;
  }

  toDict(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      error: this.code,
      message: this.message,
      recoverable: this.recoverable,
    };
    if (this.hint) payload["hint"] = this.hint;
    if (Object.keys(this.details).length > 0) payload["details"] = this.details;
    return payload;
  }
}

export class DeviceLocked extends AutomationError {
  constructor(message: string, options: AutomationErrorOptions = {}) {
    super(message, { ...options, code: ErrorCode.DEVICE_LOCKED, recoverable: true });
  }
}

/** The WDA runner process is not reachable (connection refused). */
export class RunnerCrashed extends AutomationError {
  constructor(message: string, options: AutomationErrorOptions = {}) {
    super(message, { ...options, code: ErrorCode.RUNNER_CRASHED, recoverable: true });
  }
}

/** WDA answered "invalid session id" — the session is dead. */
export class SessionLost extends AutomationError {
  constructor(message: string, options: AutomationErrorOptions = {}) {
    super(message, { ...options, code: ErrorCode.SESSION_LOST, recoverable: true });
  }
}

/**
 * A request timed out. AMBIGUOUS: the device may or may not have executed
 * the action. Never auto-heal+replay a mutating action on this error.
 */
export class ActionTimeout extends AutomationError {
  constructor(message: string, options: AutomationErrorOptions = {}) {
    super(message, { ...options, code: ErrorCode.ACTION_TIMEOUT, recoverable: false });
  }
}

/**
 * The socket died mid-flight (reset / hangup after the request was sent).
 * AMBIGUOUS like a timeout: never auto-replay mutating actions on this.
 */
export class ConnectionLost extends AutomationError {
  constructor(message: string, options: AutomationErrorOptions = {}) {
    super(message, { ...options, code: ErrorCode.CONNECTION_LOST, recoverable: false });
  }
}

export class WdaError extends AutomationError {
  constructor(message: string, options: AutomationErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? ErrorCode.WDA_ERROR });
  }
}

export class ElementNotFound extends AutomationError {
  constructor(message: string, options: AutomationErrorOptions = {}) {
    super(message, { ...options, code: ErrorCode.ELEMENT_NOT_FOUND });
  }
}

export class ElementStale extends AutomationError {
  constructor(message: string, options: AutomationErrorOptions = {}) {
    super(message, { ...options, code: ErrorCode.ELEMENT_STALE, recoverable: true });
  }
}

export class ElementNotInteractable extends AutomationError {
  constructor(message: string, options: AutomationErrorOptions = {}) {
    super(message, { ...options, code: ErrorCode.ELEMENT_NOT_INTERACTABLE });
  }
}

export class UnexpectedAlert extends AutomationError {
  constructor(message: string, options: AutomationErrorOptions = {}) {
    super(message, { ...options, code: ErrorCode.UNEXPECTED_ALERT });
  }
}

export class AppNotFound extends AutomationError {
  constructor(message: string, options: AutomationErrorOptions = {}) {
    super(message, { ...options, code: ErrorCode.APP_NOT_FOUND });
  }
}

export class NotSupported extends AutomationError {
  constructor(message: string, options: AutomationErrorOptions = {}) {
    super(message, { ...options, code: ErrorCode.NOT_SUPPORTED });
  }
}
