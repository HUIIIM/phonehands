// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/**
 * @phonehands/api-backend -- the fast engine.
 *
 * A reverse-engineered mobile HTTP client with:
 *   - phone impersonation (fingerprint.ts)
 *   - a login state machine with first-class fallback challenges (login-state-machine.ts)
 *   - session.json safety: 0600 + atomic write + path guard + zod validation (session-store.ts)
 *   - built-in self-throttling: serial queue + min interval + 429 backoff (http-client.ts)
 *   - secret hygiene: recursive redaction for output and logs (redact.ts)
 *   - capability table for the core Router (capabilities.ts)
 *
 * Compile-time read-only: this package exports no write actions at all.
 */
export type { ApiEnvelope, ApiCallError, BackendKind, Page, PageParams } from "./types.ts";
export {
  buildPhoneHeaders,
  buildUserAgent,
  newDeviceIds,
  validateLocale,
  type DeviceIds,
  type FingerprintConfig,
  type LocaleConfig,
} from "./fingerprint.ts";
export {
  ThrottledHttpClient,
  HttpStatusError,
  RateLimitedError,
  type BackendHealth,
  type HttpResult,
  type RequestOptions,
  type ThrottleOptions,
} from "./http-client.ts";
export {
  LoginStateMachine,
  EmailChallengeRequired,
  DEFAULT_AUTH_PATHS,
  type AuthPaths,
  type LoginMachineOptions,
  type LoginState,
} from "./login-state-machine.ts";
export {
  SessionStore,
  SessionCorruptError,
  SessionInsecureError,
  SessionSchema,
  type StoredSession,
} from "./session-store.ts";
export { redact, sanitizeLogLine, sanitizeUrl } from "./redact.ts";
export {
  API_READ_ACTIONS,
  KNOWN_WRITE_ACTIONS,
  assertApiCapable,
  getApiBackendCapabilities,
  isApiCapable,
  type ApiReadAction,
  type CapabilityEntry,
} from "./capabilities.ts";
