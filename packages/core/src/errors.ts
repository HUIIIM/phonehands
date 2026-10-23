// SPDX-License-Identifier: BUSL-1.1
// Typed errors for @phonehands/core. All errors carry a machine-readable `code`.

export class PhoneHandsError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

/** No backend registered for the requested (action, backend-kind, device-type). */
export class NoCapableBackendError extends PhoneHandsError {
  constructor(action: string, kind: string, deviceType?: string) {
    super(
      "NO_CAPABLE_BACKEND",
      `no backend registered for action "${action}" (kind=${kind}${deviceType ? `, deviceType=${deviceType}` : ""}); refusing silent substitution`
    );
  }
}

/** Action is not registered (e.g. a write action in a read-only build). */
export class ActionNotRegisteredError extends PhoneHandsError {
  constructor(action: string) {
    super("ACTION_NOT_REGISTERED", `action "${action}" is not registered in this build`);
  }
}

/** A device-kind dispatch without deviceType ("ios" | "android"). */
export class DeviceTypeRequiredError extends PhoneHandsError {
  constructor(action: string) {
    super("DEVICE_TYPE_REQUIRED", `deviceType ("ios" | "android") is required to route device action "${action}"`);
  }
}

/** Backend returned an envelope that violates the contract. */
export class ResultValidationError extends PhoneHandsError {
  constructor(message: string) {
    super("RESULT_VALIDATION", message);
  }
}

/** A device backend must declare its platform at registration time. */
export class PlatformDeclarationError extends PhoneHandsError {
  constructor(backendName: string) {
    super(
      "PLATFORM_DECLARATION",
      `device backend "${backendName}" must declare devicePlatform ("ios" | "android")`
    );
  }
}

/** Router emergency stop is engaged: no new dispatches allowed. */
export class EmergencyStoppedError extends PhoneHandsError {
  constructor() {
    super("EMERGENCY_STOPPED", "router emergency stop engaged: dispatch refused");
  }
}

/** Operation queue is full for this account. */
export class QueueFullError extends PhoneHandsError {
  constructor(accountId: string, limit: number) {
    super("QUEUE_FULL", `op queue full for account "${accountId}" (limit ${limit}); caller must back off`);
  }
}

/**
 * Operation exceeded its deadline. The outcome is UNKNOWN (MV427):
 * the action may or may not have executed on the device. Callers must
 * "check first, then act" — never auto-replay submit-kind actions.
 */
export class TimeoutUnknownError extends PhoneHandsError {
  constructor(accountId: string, deadlineMs: number) {
    super(
      "TIMEOUT_UNKNOWN",
      `op for account "${accountId}" exceeded ${deadlineMs}ms deadline; outcome unknown — do not auto-replay submit actions`
    );
  }
}

/** Auth handoff timed out waiting for a human to complete the auth wall. */
export class AuthTimeoutError extends PhoneHandsError {
  constructor(accountId: string) {
    super("abandoned:auth_timeout", `auth handoff timed out for account "${accountId}": task abandoned, queue released`);
  }
}
