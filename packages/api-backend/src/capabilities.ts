// SPDX-License-Identifier: BUSL-1.1

/**
 * Capability declarations for the API backend.
 *
 * The core Router looks these up instead of hardcoding if-else routing.
 * Read-only is a compile-time property of this package: there is no write
 * method to register, disable, or bypass -- writes simply do not exist here.
 */

export const API_READ_ACTIONS = ["read", "likes_received", "matches", "chat_messages"] as const;

/**
 * Write actions are known BY NAME and explicitly refused, so a future
 * adapter cannot silently gain write power through this backend.
 */
export const KNOWN_WRITE_ACTIONS = [
  "tap",
  "tap_text",
  "swipe",
  "type_text",
  "like",
  "skip",
  "send_message",
  "update_preferences",
  "launch_app",
  "press_home",
] as const;

export type ApiReadAction = (typeof API_READ_ACTIONS)[number];

export interface CapabilityEntry {
  supported: boolean;
  /** Why, in one sentence -- for Router diagnostics. */
  reason: string;
}

export function getApiBackendCapabilities(): Record<string, CapabilityEntry> {
  const table: Record<string, CapabilityEntry> = {};
  for (const action of API_READ_ACTIONS) {
    table[action] = {
      supported: true,
      reason: "api engine: millisecond structured reads",
    };
  }
  for (const action of KNOWN_WRITE_ACTIONS) {
    table[action] = {
      supported: false,
      reason: "api engine is compile-time read-only; writes belong to the device engine",
    };
  }
  return table;
}

/**
 * Router helper: throws when the action is not supported by the API engine.
 * Unknown actions are treated as unsupported (fail closed).
 */
export function assertApiCapable(action: string): void {
  const table = getApiBackendCapabilities();
  const entry = table[action];
  if (!entry || !entry.supported) {
    throw new Error(
      `phonehands: action "${action}" is not supported by the api backend (${entry?.reason ?? "unknown action; fail closed"})`,
    );
  }
}

/** True when the API engine can perform the action (for Router table lookup). */
export function isApiCapable(action: string): boolean {
  const entry = getApiBackendCapabilities()[action];
  return entry !== undefined && entry.supported;
}
