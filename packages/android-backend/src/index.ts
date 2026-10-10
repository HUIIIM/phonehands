// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/**
 * @phonehands/android-backend — wireless-first Android device engine.
 *
 * The phone dials OUT to the agent's WebSocket relay (PHONEHANDS_RELAY_URL):
 * NAT-safe, no USB, no same-LAN requirement — the "true wireless" iOS
 * cannot do. All results use the phonehands envelope:
 *   { ok, backend: "device", devicePlatform: "android",
 *     latency_ms, degraded, evidence }
 *
 * Public surface:
 *   AndroidRelayServer  agent-side WS server (self-hosted; run it behind
 *                       an SSH reverse tunnel for remote operation)
 *   AndroidDevice       per-phone action handle (tap/swipe/screenshot/
 *                       launch/observe)
 *   checkRelay          unified healthcheck { relay, reachable, latency_ms, path }
 *   relayUrlFromEnv / parseRelayUrl   PHONEHANDS_RELAY_URL convention
 *   MockAndroidDevice   test double (protocol-faithful, no real phone)
 *   wireless-adb        documented fallback hook (commands only, not wired)
 *   ANDROID_CAPABILITIES / canHandle / capabilityFor   Router lookup table
 */

export { AndroidRelayServer, type ConnectedDeviceInfo } from "./server.ts";
export { AndroidDevice } from "./device.ts";
export { checkRelay } from "./healthcheck.ts";
export {
  relayUrlFromEnv,
  parseRelayUrl,
  DEFAULT_RELAY_URL,
  DEFAULT_PORT,
  DEFAULT_BIND_HOST,
  RelayUrlError,
} from "./relay-url.ts";
export {
  decodeUplink,
  encodeAction,
  encodePing,
  newActionId,
  describeMessage,
  ProtocolError,
} from "./protocol.ts";
export {
  ANDROID_CAPABILITIES,
  CORE_ACTION_TO_ANDROID,
  canHandle,
  capabilityFor,
  DEVICE_PLATFORM,
  type AndroidCapability,
} from "./capabilities.ts";
export { MockAndroidDevice, MOCK_JPEG_B64 } from "./mock-device.ts";
export {
  tapCommand,
  swipeCommand,
  screenshotCommand,
  launchCommand,
  adbFailure,
  WIRELESS_ADB_PAIRING_NOTE,
  type AdbTarget,
} from "./wireless-adb.ts";
export type {
  AndroidEnvelope,
  DevicePlatform,
  AndroidActionName,
  TapParams,
  SwipeParams,
  LaunchParams,
  ActionParams,
  HelloMessage,
  AckMessage,
  FrameMessage,
  UplinkMessage,
  RelayPath,
  RelayHealth,
  RelayServerOptions,
} from "./types.ts";
