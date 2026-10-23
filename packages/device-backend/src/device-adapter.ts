// SPDX-License-Identifier: BUSL-1.1

/**
 * DeviceAdapter protocol — the device abstraction the Router programs against.
 *
 * Pattern learned from ios_mcp/devices/base.py in emazaheri/ios-agent
 * (MIT): "Everything platform-specific lives behind DeviceAdapter so that
 * layers above never branch on device kind." Our Router does the same via
 * capability declarations (src/capabilities.ts); this interface is the
 * contract a backend implements. Written from scratch for phonehands.
 */

import type { DeviceEnvelope, UiTree } from "./types.ts";

export interface DeviceInfo {
  /** Human-readable device label (never a credential). */
  name: string;
  /** Loopback base URL of the WDA runner, e.g. http://127.0.0.1:8100. */
  baseUrl: string;
}

/**
 * In-band UI automation contract. Lifecycle/out-of-band control
 * (runner process start/stop) is owned by the topology layer, not here.
 */
export interface DeviceAdapter {
  readonly info: DeviceInfo;

  /** Open a WDA session (idempotent). */
  connect(): Promise<DeviceEnvelope>;

  /** Close the WDA session (best-effort). */
  disconnect(): Promise<DeviceEnvelope>;

  /** Liveness probe. */
  health(): Promise<DeviceEnvelope>;

  /** Observe: tree-first, screenshot fallback (degrade chain). */
  observe(): Promise<DeviceEnvelope>;

  /** Tap at WDA logical coordinates. */
  tap(x: number, y: number): Promise<DeviceEnvelope>;

  /** Swipe from (fromX,fromY) to (toX,toY). */
  swipe(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    durationMs?: number,
  ): Promise<DeviceEnvelope>;

  /** Type text into the focused field. */
  type(text: string): Promise<DeviceEnvelope>;

  /** Tap the tree node whose label/name matches. */
  tapText(label: string): Promise<DeviceEnvelope>;

  /** Raw PNG screenshot bytes. */
  screenshot(): Promise<DeviceEnvelope>;

  /** Logical screen size in points (fresh per call — see fallback.ts). */
  windowSize(): Promise<{ width: number; height: number }>;

  /** Parsed tree from the last observe(), if one was usable. */
  lastTree(): UiTree | null;
}
