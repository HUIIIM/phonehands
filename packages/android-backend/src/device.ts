// SPDX-License-Identifier: BUSL-1.1

/**
 * AndroidDevice — per-phone action handle on the agent side.
 *
 * Wraps AndroidRelayServer.sendAction() and translates wire results into the
 * phonehands envelope:
 *   { ok, backend: "device", devicePlatform: "android",
 *     latency_ms, degraded, evidence }
 *
 * Conventions (aligned with device-backend):
 *  - tap(x, y) takes FRAME pixels (the 360px stream / screenshot pixels)
 *    and scales to device pixels using the hello dimensions.
 *  - screenshot() returns the latest streamed frame as a Buffer (JPEG).
 *  - observe() returns the accessibility tree (nodes array).
 *  - A null ack (timeout / disconnect) on tap/swipe/launch is evidence
 *    { uncertain: true } — the caller must re-observe, never replay.
 */

import type { AndroidRelayServer, ConnectedDeviceInfo } from "./server.ts";
import type {
  AndroidActionName,
  AndroidEnvelope,
} from "./types.ts";

const MUTATING = new Set<AndroidActionName>(["tap", "swipe", "launch"]);

export class AndroidDevice {
  private readonly server: AndroidRelayServer;
  readonly info: ConnectedDeviceInfo;

  constructor(server: AndroidRelayServer, info: ConnectedDeviceInfo) {
    this.server = server;
    this.info = info;
  }

  get deviceId(): string {
    return this.info.deviceId;
  }

  /** Tap at frame pixels (e.g. the 360px-wide stream); scaled to device px. */
  async tap(frameX: number, frameY: number): Promise<AndroidEnvelope> {
    const latest = this.info.latestFrame;
    if (!latest) {
      return this.fail("tap", "no frame yet: cannot map coordinates", {});
    }
    const x = Math.round((frameX / latest.width) * this.info.width);
    const y = Math.round((frameY / latest.height) * this.info.height);
    return this.run("tap", { x, y }, { frame_x: frameX, frame_y: frameY, device_x: x, device_y: y });
  }

  /** Swipe in frame pixels; duration_ms default 300. */
  async swipe(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    durationMs = 300,
  ): Promise<AndroidEnvelope> {
    const latest = this.info.latestFrame;
    if (!latest) {
      return this.fail("swipe", "no frame yet: cannot map coordinates", {});
    }
    const sx = (v: number, w: number, dw: number) => Math.round((v / w) * dw);
    return this.run(
      "swipe",
      {
        x1: sx(x1, latest.width, this.info.width),
        y1: sx(y1, latest.height, this.info.height),
        x2: sx(x2, latest.width, this.info.width),
        y2: sx(y2, latest.height, this.info.height),
        duration_ms: durationMs,
      },
      { from: [x1, y1], to: [x2, y2] },
    );
  }

  /** Latest streamed frame as a JPEG Buffer. */
  async screenshot(): Promise<AndroidEnvelope> {
    const ack = await this.server.sendAction(this.deviceId, "screenshot", {});
    const data = ack?.data;
    const b64 =
      typeof data?.jpeg_b64 === "string" ? data.jpeg_b64 : this.info.latestFrame?.jpeg_b64;
    if (!b64) {
      return this.fail("screenshot", "no frame available", {});
    }
    return {
      ok: true,
      backend: "device",
      devicePlatform: "android",
      latency_ms: ack?.latency_ms ?? -1,
      degraded: false,
      evidence: {
        jpeg_bytes: Buffer.from(b64, "base64"),
        width: (data?.width as number) ?? this.info.latestFrame?.width ?? 0,
        height: (data?.height as number) ?? this.info.latestFrame?.height ?? 0,
        frame_age_ms: (data?.frame_age_ms as number) ?? -1,
      },
    };
  }

  /** Accessibility tree (nodes array, possibly truncated at 500). */
  async observe(): Promise<AndroidEnvelope> {
    const ack = await this.server.sendAction(this.deviceId, "observe", {});
    if (!ack) {
      return this.fail("observe", "no ack (timeout/disconnect)", { uncertain: false });
    }
    if (!ack.ok) {
      return this.fail("observe", ack.error ?? "phone reported failure", {});
    }
    const data = ack.data ?? {};
    return {
      ok: true,
      backend: "device",
      devicePlatform: "android",
      latency_ms: ack.latency_ms,
      degraded: false,
      evidence: {
        nodes: Array.isArray(data.nodes) ? data.nodes : [],
        truncated: data.truncated === true,
      },
    };
  }

  /** Launch an app by package name. */
  async launch(packageName: string): Promise<AndroidEnvelope> {
    return this.run("launch", { package: packageName }, { package: packageName });
  }

  private async run(
    action: AndroidActionName,
    params: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<AndroidEnvelope> {
    const started = Date.now();
    const ack = await this.server.sendAction(this.deviceId, action, params);
    const latency = Date.now() - started;
    if (!ack) {
      // MV427: never auto-replay. Mark uncertain for mutating actions.
      return {
        ok: false,
        backend: "device",
        devicePlatform: "android",
        latency_ms: latency,
        degraded: false,
        evidence: {
          reason: "no ack (timeout or disconnect)",
          uncertain: MUTATING.has(action),
          ...context,
        },
      };
    }
    return {
      ok: ack.ok,
      backend: "device",
      devicePlatform: "android",
      latency_ms: ack.latency_ms >= 0 ? ack.latency_ms : latency,
      degraded: false,
      evidence: ack.ok
        ? context
        : { reason: ack.error ?? "phone reported failure", ...context },
    };
  }

  private fail(
    action: string,
    reason: string,
    extra: Record<string, unknown>,
  ): AndroidEnvelope {
    return {
      ok: false,
      backend: "device",
      devicePlatform: "android",
      latency_ms: 0,
      degraded: false,
      evidence: { action, reason, ...extra },
    };
  }
}
