// SPDX-License-Identifier: BUSL-1.1

/**
 * AndroidRelayServer — the agent-side WebSocket server.
 *
 * The phone dials IN (NAT-safe, no USB, no same-LAN). The server:
 *  - authenticates hello.token when a token is configured (mismatch -> close)
 *  - dedupes reconnects by device_id (new socket replaces the old one)
 *  - keeps the latest frame per device (screenshot = latest frame)
 *  - matches ack -> pending action by id, with a timeout that marks
 *    mutating actions uncertain (MV427: never auto-replay uncertain input)
 *  - sends ping every 30s; drops sockets idle > 90s
 *
 *  - refuses a non-loopback bindHost without an authToken (fail closed)
 *  - closes sockets that send no valid hello within helloTimeoutMs, and caps
 *    inbound message size (maxPayloadBytes)
 *
 * Secrets: hello.token is compared in constant-ish time and never logged;
 * log lines use describeMessage() (token reduced to present/absent).
 */

import { WebSocketServer, WebSocket } from "ws";
import {
  decodeUplink,
  encodeAction,
  encodePing,
  newActionId,
  ProtocolError,
} from "./protocol.ts";
import type {
  AckMessage,
  AndroidActionName,
  FrameMessage,
  HelloMessage,
  RelayServerOptions,
} from "./types.ts";

const PING_INTERVAL_MS = 30_000;
const IDLE_TIMEOUT_MS = 90_000;
const LOOPBACK_BIND_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

interface PendingAction {
  resolve: (ack: AckMessage | null) => void;
  timer: NodeJS.Timeout;
  /** True for tap/swipe/launch: on timeout these are UNCERTAIN, not failed. */
  mutating: boolean;
}

export interface ConnectedDeviceInfo {
  deviceId: string;
  model: string;
  width: number;
  height: number;
  densityDpi: number;
  capabilities: string[];
  connectedAt: number;
  lastFrameAt: number;
  latestFrame: FrameMessage | null;
}

interface DeviceSocket {
  ws: WebSocket;
  info: ConnectedDeviceInfo;
  pending: Map<string, PendingAction>;
  lastActivity: number;
  authed: boolean;
}

export class AndroidRelayServer {
  private wss: WebSocketServer | null = null;
  private devices = new Map<string, DeviceSocket>();
  private pingTimer: NodeJS.Timeout | null = null;
  readonly options: Required<RelayServerOptions>;
  /** Fires when a device (re)connects with a valid hello. */
  onDevice: ((info: ConnectedDeviceInfo) => void) | null = null;
  /** Fires when a device disconnects. */
  onDeviceLost: ((deviceId: string) => void) | null = null;

  constructor(options: RelayServerOptions) {
    this.options = {
      bindHost: "127.0.0.1",
      authToken: "",
      actionTimeoutMs: 15_000,
      helloTimeoutMs: 10_000,
      maxPayloadBytes: 16 * 1024 * 1024,
      ...options,
    };
    if (!this.options.authToken && !LOOPBACK_BIND_HOSTS.has(this.options.bindHost.toLowerCase())) {
      throw new Error(
        `android-relay: refusing to bind ${this.options.bindHost} without an authToken ` +
          "(an unauthenticated non-loopback relay lets anyone impersonate the phone)",
      );
    }
  }

  /** OS-assigned port after start() (useful with port: 0 in tests). */
  get boundPort(): number | null {
    const addr = this.wss?.address();
    if (addr && typeof addr === "object" && "port" in addr) return addr.port as number;
    return null;
  }

  /** Start listening. Resolves when the socket is bound. */
  async start(): Promise<void> {
    if (this.wss) return;
    this.wss = new WebSocketServer({
      host: this.options.bindHost,
      port: this.options.port,
      maxPayload: this.options.maxPayloadBytes,
    });
    await new Promise<void>((resolve, reject) => {
      this.wss!.once("listening", () => resolve());
      this.wss!.once("error", reject);
    });
    this.wss.on("connection", (ws) => this.handleConnection(ws));
    this.pingTimer = setInterval(() => this.keepaliveSweep(), PING_INTERVAL_MS);
    this.pingTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const [, d] of this.devices) {
      d.ws.close(1000, "server stopping");
      for (const [, p] of d.pending) {
        clearTimeout(p.timer);
        p.resolve(null);
      }
    }
    this.devices.clear();
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });
    this.wss = null;
  }

  /** Snapshot of currently connected devices. */
  listDevices(): ConnectedDeviceInfo[] {    return [...this.devices.values()].map((d) => d.info);
  }

  /** Send an action to a device and wait for its ack (or timeout -> null). */
  sendAction(
    deviceId: string,
    action: AndroidActionName,
    params: Record<string, unknown> = {},
  ): Promise<AckMessage | null> {
    const dev = this.devices.get(deviceId);
    if (!dev || dev.ws.readyState !== WebSocket.OPEN) {
      return Promise.resolve(null);
    }
    const id = newActionId();
    return new Promise((resolve) => {
      const mutating = action === "tap" || action === "swipe" || action === "launch";
      const timer = setTimeout(() => {
        dev.pending.delete(id);
        // Timeout: mutating actions are UNCERTAIN (MV427) — resolve null and
        // let the caller mark evidence.uncertain = true instead of failing.
        resolve(null);
      }, this.options.actionTimeoutMs);
      timer.unref?.();
      dev.pending.set(id, { resolve, timer, mutating });
      dev.ws.send(encodeAction(id, action, params), (err) => {
        if (err) {
          clearTimeout(timer);
          dev.pending.delete(id);
          resolve(null);
        }
      });
    });
  }

  private handleConnection(ws: WebSocket): void {
    let deviceId: string | null = null;
    const helloTimer = setTimeout(() => {
      if (deviceId === null) ws.close(4408, "hello timeout");
    }, this.options.helloTimeoutMs);
    helloTimer.unref?.();
    ws.on("message", (data) => {
      let msg;
      try {
        msg = decodeUplink(data.toString());
      } catch (e) {
        if (e instanceof ProtocolError) {
          // Malformed frame: ignore, keep the socket alive. hello is the
          // only gate; garbage before hello just delays auth.
          return;
        }
        throw e;
      }
      // Gate: first message must be a valid hello.
      if (deviceId === null) {
        if (msg.type !== "hello") {
          ws.close(4401, "hello required");
          return;
        }
        const hello = msg as HelloMessage;
        if (!this.checkToken(hello.token)) {
          ws.close(4403, "bad token");
          return;
        }
        deviceId = hello.device_id;
        clearTimeout(helloTimer);
        // Dedupe: a reconnecting phone replaces its stale socket.
        // NOTE: local const keeps the registered id as `string`; the closure
        // variable `deviceId` stays `string | null` for the hello gate above.
        const registeredId: string = hello.device_id;
        const stale = this.devices.get(registeredId);
        if (stale) {
          for (const [, p] of stale.pending) {
            clearTimeout(p.timer);
            p.resolve(null);
          }
          stale.ws.close(1000, "replaced by reconnect");
        }
        const dev: DeviceSocket = {
          ws,
          info: {
            deviceId: registeredId,
            model: hello.model,
            width: hello.width,
            height: hello.height,
            densityDpi: hello.density_dpi,
            capabilities: hello.capabilities,
            connectedAt: Date.now(),
            lastFrameAt: 0,
            latestFrame: null,
          },
          pending: new Map(),
          lastActivity: Date.now(),
          authed: true,
        };
        this.devices.set(registeredId, dev);
        this.onDevice?.(dev.info);
        return;
      }
      const dev = this.devices.get(deviceId);
      if (!dev) return;
      dev.lastActivity = Date.now();
      if (msg.type === "ack") {
        const pending = dev.pending.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          dev.pending.delete(msg.id);
          pending.resolve(msg);
        }
      } else if (msg.type === "frame") {
        dev.info.latestFrame = msg;
        dev.info.lastFrameAt = Date.now();
      }
      // pong: nothing to do beyond lastActivity.
    });

    const forget = () => {
      clearTimeout(helloTimer);
      if (deviceId && this.devices.get(deviceId)?.ws === ws) {
        this.devices.delete(deviceId);
        this.onDeviceLost?.(deviceId);
      }
    };
    ws.on("close", forget);
    ws.on("error", forget);
  }

  /** Constant-ish-time token compare; empty configured token = no auth. */
  private checkToken(presented: string): boolean {
    const expected = this.options.authToken;
    if (!expected) return true;
    if (presented.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
    }
    return diff === 0;
  }

  private keepaliveSweep(): void {
    const now = Date.now();
    for (const [id, dev] of this.devices) {
      if (now - dev.lastActivity > IDLE_TIMEOUT_MS) {
        dev.ws.close(1000, "idle");
        this.devices.delete(id);
        this.onDeviceLost?.(id);
        continue;
      }
      if (dev.ws.readyState === WebSocket.OPEN) {
        dev.ws.send(encodePing(newActionId()));
      }
    }
  }

  /** For tests/diagnostics: describe one device without secrets. */
  describe(deviceId: string): string {
    const dev = this.devices.get(deviceId);
    if (!dev) return `device ${deviceId}: not connected`;
    const i = dev.info;
    return `device ${i.deviceId}: ${i.model} ${i.width}x${i.height} ` +
      `caps=[${i.capabilities.join(",")}] frames=${i.latestFrame ? "yes" : "no"}`;
  }
}
