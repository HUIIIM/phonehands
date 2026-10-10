// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/**
 * MockAndroidDevice — a fake phone implementing the wire protocol.
 *
 * Used by tests and the wireless demo ONLY. It never touches a real phone.
 * Behavior:
 *  - connects to the relay, sends hello
 *  - tap / swipe / launch / observe -> ack ok (records received actions)
 *  - screenshot -> ack with a synthetic 360px JPEG (generated once)
 *  - pushes a synthetic frame every frameIntervalMs
 *  - token: sends options.token (or ""), so auth paths are testable
 *
 * The synthetic JPEG is a minimal valid 1x1 JPEG, reported at 360x780 —
 * enough for base64/codec roundtrips. Tests assert on shape, not pixels.
 */

import { WebSocket } from "ws";
import type { AndroidActionName } from "./types.ts";

// Minimal valid 1x1 JPEG (SOI..EOI). Decodes in every image library.
const TINY_JPEG_B64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////2wBDAf//////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8AH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8AH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8AH//Z";

export interface MockDeviceOptions {
  deviceId?: string;
  model?: string;
  width?: number;
  height?: number;
  token?: string;
  frameIntervalMs?: number;
}

export interface ReceivedAction {
  id: string;
  action: AndroidActionName;
  params: Record<string, unknown>;
}

export class MockAndroidDevice {
  readonly deviceId: string;
  readonly receivedActions: ReceivedAction[] = [];
  private ws: WebSocket | null = null;
  private frameTimer: NodeJS.Timeout | null = null;
  private seq = 0;
  private readonly opts: Required<MockDeviceOptions>;

  private readonly relayUrl: string;

  constructor(relayUrl: string, opts: MockDeviceOptions = {}) {
    this.relayUrl = relayUrl;
    this.opts = {
      deviceId: "mock-phone-1",
      model: "Mock Pixel",
      width: 1080,
      height: 2400,
      token: "",
      frameIntervalMs: 500,
      ...opts,
    };
    this.deviceId = this.opts.deviceId;
  }

  /** Connect and send hello. Resolves when the socket is open. */
  async connect(): Promise<void> {
    this.ws = new WebSocket(this.relayUrl);
    await new Promise<void>((resolve, reject) => {
      this.ws!.once("open", () => resolve());
      this.ws!.once("error", reject);
    });
    this.ws.on("message", (data) => this.onMessage(data.toString()));
    this.sendHello();
    this.frameTimer = setInterval(() => this.pushFrame(), this.opts.frameIntervalMs);
    this.frameTimer.unref?.();
  }

  async disconnect(): Promise<void> {
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.frameTimer = null;
    await new Promise<void>((resolve) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return resolve();
      this.ws.once("close", () => resolve());
      this.ws.close(1000, "mock done");
      setTimeout(resolve, 1000).unref?.();
    });
    this.ws = null;
  }

  private sendHello(): void {
    const hello = {
      type: "hello",
      device_id: this.opts.deviceId,
      platform: "android",
      model: this.opts.model,
      width: this.opts.width,
      height: this.opts.height,
      density_dpi: 420,
      capabilities: ["tap", "swipe", "screenshot", "launch", "observe"],
      token: this.opts.token,
    };
    this.ws!.send(JSON.stringify(hello));
  }

  private pushFrame(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.seq += 1;
    this.ws.send(
      JSON.stringify({
        type: "frame",
        seq: this.seq,
        ts: Date.now(),
        width: 360,
        height: 780,
        format: "jpeg",
        jpeg_b64: TINY_JPEG_B64,
      }),
    );
  }

  private onMessage(text: string): void {
    let msg: { type?: string; id?: string; action?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type === "ping") {
      this.ws!.send(JSON.stringify({ type: "pong", id: msg.id }));
      return;
    }
    if (msg.type !== "action" || !msg.id) return;
    const action = msg.action as AndroidActionName;
    const params = msg.params ?? {};
    this.receivedActions.push({ id: msg.id, action, params });
    const started = Date.now();
    const ack = (ok: boolean, error: string | null, data: Record<string, unknown> | null) =>
      this.ws!.send(
        JSON.stringify({
          type: "ack",
          id: msg.id,
          ok,
          latency_ms: Date.now() - started,
          error,
          data,
        }),
      );
    switch (action) {
      case "tap":
      case "swipe":
      case "launch":
        ack(true, null, null);
        break;
      case "screenshot":
        ack(true, null, {
          jpeg_b64: TINY_JPEG_B64,
          width: 360,
          height: 780,
          frame_age_ms: 12,
        });
        break;
      case "observe":
        ack(true, null, {
          nodes: [
            {
              class: "android.widget.FrameLayout",
              text: "",
              content_desc: "",
              bounds: [0, 0, 1080, 2400],
              clickable: false,
            },
            {
              class: "android.widget.Button",
              text: "Mock OK",
              content_desc: "",
              bounds: [490, 1180, 590, 1280],
              clickable: true,
            },
          ],
          truncated: false,
        });
        break;
      default:
        ack(false, `unknown action: ${action}`, null);
    }
  }
}

/** Exported for tests that want to assert the synthetic JPEG decodes. */
export const MOCK_JPEG_B64 = TINY_JPEG_B64;
