// SPDX-License-Identifier: BUSL-1.1

/**
 * Shared types for @phonehands/android-backend.
 *
 * The result envelope matches the phonehands core contract, with one added
 * discriminator so the Router can tell the two device engines apart:
 *   { ok, backend: "device", devicePlatform: "android" | "ios",
 *     latency_ms, degraded, evidence }
 */

export type DevicePlatform = "android" | "ios";

/** Envelope returned by every android-backend action. */
export interface AndroidEnvelope {
  ok: boolean;
  backend: "device";
  devicePlatform: "android";
  latency_ms: number;
  degraded: boolean;
  /** Machine-readable detail. On failure carries the reason; on timeout of
   *  a mutating action carries uncertain: true (never auto-replayed). */
  evidence: Record<string, unknown>;
}

/** Downlink action names the MVP phone implements. */
export type AndroidActionName =
  | "tap"
  | "swipe"
  | "screenshot"
  | "launch"
  | "observe";

export interface TapParams {
  x: number;
  y: number;
}
export interface SwipeParams {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  duration_ms: number;
}
export interface LaunchParams {
  package: string;
}
export type ActionParams =
  | TapParams
  | SwipeParams
  | LaunchParams
  | Record<string, never>;

export interface HelloMessage {
  type: "hello";
  device_id: string;
  platform: "android";
  model: string;
  width: number;
  height: number;
  density_dpi: number;
  capabilities: string[];
  token: string;
}

export interface AckMessage {
  type: "ack";
  id: string;
  ok: boolean;
  latency_ms: number;
  error: string | null;
  data: Record<string, unknown> | null;
}

export interface FrameMessage {
  type: "frame";
  seq: number;
  ts: number;
  width: number;
  height: number;
  format: "jpeg";
  jpeg_b64: string;
}

export type UplinkMessage = HelloMessage | AckMessage | FrameMessage | { type: "pong"; id: string };

/** Unified healthcheck schema (aligned with the iOS side). */
export type RelayPath = "ssh-tunnel" | "tailscale" | "direct" | "usb";

export interface RelayHealth {
  relay: string;
  reachable: boolean;
  latency_ms: number;
  path: RelayPath;
}

/** Options for AndroidRelayServer. */
export interface RelayServerOptions {
  /** Parsed from PHONEHANDS_RELAY_URL; see relay-url.ts. */
  port: number;
  /** Bind host. Default "127.0.0.1". */
  bindHost?: string;
  /**
   * Shared secret; phones must present it in hello.token. Optional only on a
   * loopback bindHost — any other bindHost without a token is refused.
   */
  authToken?: string;
  /** Per-action ack timeout. Default 15_000. */
  actionTimeoutMs?: number;
  /** A socket that has not sent a valid hello by then is closed. Default 10_000. */
  helloTimeoutMs?: number;
  /** Max inbound message size in bytes. Default 16 MiB (one JPEG frame). */
  maxPayloadBytes?: number;
}
