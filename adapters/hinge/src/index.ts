// SPDX-License-Identifier: BUSL-1.1

/**
 * @phonehands/hinge-adapter -- Hinge app adapter (MVP: read-only).
 *
 * Reads (likes_received / matches / chat_messages) through the API engine,
 * wrapped in the core envelope. Tests run exclusively against the bundled
 * mock server -- never the real Hinge API, never a real account.
 */
export {
  HingeApiAdapter,
  HINGE_CAPABILITIES,
  HINGE_FINGERPRINT_BASE,
  HINGE_PRODUCTION_BASE_URL,
  type ChatMessage,
  type HingeAdapterOptions,
  type HingeReadKind,
  type LikeSummary,
  type MatchSummary,
} from "./hinge-adapter.ts";
export { startMockHingeServer, type MockHingeServer } from "./mock-server.ts";
export { promptSecret, NoTtyError } from "./secure-prompt.ts";
export {
  WRITE_ALLOWLIST_ENV,
  KNOWN_WRITE_TOOLS,
  getEnabledWriteTools,
  parseWriteAllowlist,
  assertWriteEnabled,
  WriteNotEnabledError,
  type WriteToolDef,
} from "./write-tools.ts";
