// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/**
 * @phonehands/device-backend — USB -> WebDriverAgent device engine.
 *
 * Base: emazaheri/ios-agent (MIT; see NOTICE.md) — WDA typed client
 * architecture (transport -> session -> backend), DeviceAdapter
 * protocol idea, snapshot tuning, auto-heal, per-frame pixel scaling.
 * phonehands redlines (loopback-only, degrade chain, never-replay-uncertain,
 * redacted audit) live in device-backend.ts and are never bypassed.
 *
 * Public surface:
 *   DeviceBackend          envelope-level engine (implements DeviceAdapter)
 *   DeviceAdapter          protocol the Router programs against
 *   WdaSession             session lifecycle + auto-heal (MIT, adapted)
 *   WdaTransport           low-level WDA HTTP client (MIT, adapted)
 *   screenshotToTapPoint   screenshot-fallback pixel mapping (MV427 loop)
 *   DEVICE_CAPABILITIES / canHandle / capabilityFor  Router lookup table
 *   assertLoopbackHost / assertLoopbackUrl           loopback-only guard
 *   audit helpers          redacted audit ring (no sensitive fields)
 */

export { DeviceBackend, type DeviceBackendOptions } from "./device-backend.ts";
export type { DeviceAdapter, DeviceInfo } from "./device-adapter.ts";
export { WdaSession, type SessionOptions } from "./wda/session.ts";
export { WdaTransport, type TransportOptions } from "./wda/transport.ts";
export {
  DEFAULT_SNAPSHOT_TUNING,
  snapshotSettingsPayload,
  type SnapshotTuning,
} from "./wda/settings.ts";
export {
  AutomationError,
  DeviceLocked,
  RunnerCrashed,
  SessionLost,
  ActionTimeout,
  ConnectionLost,
  WdaError,
  ElementNotFound,
  ElementStale,
  ElementNotInteractable,
  UnexpectedAlert,
  AppNotFound,
  NotSupported,
  ErrorCode,
} from "./wda/errors.ts";
export { parseAccessibilityTree } from "./tree.ts";
export {
  screenshotToTapPoint,
  pngDimensions,
  OrientationMismatchError,
  SCALE_TOLERANCE,
  type NormalizedBox,
  type ScreenshotOrientation,
  type FallbackGeometry,
  type TapPoint,
} from "./fallback.ts";
export {
  DEVICE_CAPABILITIES,
  CORE_ACTION_TO_DEVICE,
  canHandle,
  capabilityFor,
  type DeviceCapability,
} from "./capabilities.ts";
export { assertLoopbackHost, assertLoopbackUrl } from "./loopback-guard.ts";
export { DeviceSecurityError } from "./security-errors.ts";
export {
  recordAudit,
  getAuditLog,
  clearAuditLog,
  setAuditSink,
  type AuditEntry,
} from "./audit.ts";
export type {
  DeviceEnvelope,
  UiNode,
  UiTree,
  ObserveData,
  TapTarget,
  WdaClientOptions,
} from "./types.ts";
