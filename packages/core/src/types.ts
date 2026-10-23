// SPDX-License-Identifier: BUSL-1.1
// Shared types for @phonehands/core: backends, platforms, auth walls, envelopes.

import { ResultValidationError } from "./errors.ts";

/** The two engines: fast API vs. real device taps. */
export type BackendKind = "api" | "device";

/** Device platform. Required on every envelope whose backend is "device". */
export type DevicePlatform = "ios" | "android";

/** Auth wall kinds the framework can pause on. The framework never handles
 *  the credential itself — it only records wallType + timestamp. */
export type AuthWallType = "password" | "face_id" | "otp_sms" | "captcha" | "unknown";

/** Machine-readable error attached to a failed ActionResult. */
export interface ActionError {
  code: string;
  message: string;
  /** Present only when code === "AUTH_REQUIRED". */
  wallType?: AuthWallType;
}

/** The code a backend returns when the phone shows an auth wall
 *  (password / Face ID / SMS code screen). */
export const AUTH_REQUIRED = "AUTH_REQUIRED";

/**
 * Unified result envelope. EVERY action result carries this — the caller
 * always knows which hand acted, whether it degraded, and whether any
 * privilege-tier change happened (and it never happens silently).
 */
export interface ActionResult {
  ok: boolean;
  backend: BackendKind;
  /** Router-measured round-trip time. */
  latency_ms: number;
  /** True when the API engine was degraded and the device engine took over. */
  degraded: boolean;
  /** True only when the caller explicitly allowed a cross-kind substitution
   *  (allowEscalation). The Router NEVER sets this on its own. */
  escalated: boolean;
  /** Opaque backend evidence. MUST NOT contain credentials, tokens, OTPs. */
  evidence: unknown;
  /** Required when backend === "device" ("ios" | "android"); must be absent otherwise. */
  devicePlatform?: DevicePlatform;
  error?: ActionError;
}

/**
 * Contract check applied by the Router to every backend result.
 * Throws ResultValidationError on violation.
 */
export function validateResult(result: ActionResult): void {
  if (result.backend === "device") {
    if (result.devicePlatform !== "ios" && result.devicePlatform !== "android") {
      throw new ResultValidationError(
        `devicePlatform ("ios" | "android") is required when backend is "device", got ${String(
          result.devicePlatform
        )}`
      );
    }
  } else if (result.devicePlatform !== undefined) {
    throw new ResultValidationError(
      `devicePlatform must be absent when backend is "api", got "${result.devicePlatform}"`
    );
  }
}
