// SPDX-License-Identifier: BUSL-1.1

/**
 * Protocol encode/decode for the Android wire protocol.
 * Mirrors packages/android-helper/PROTOCOL.md. No I/O here — pure codecs,
 * fully unit-testable. Secrets (hello.token) are never logged: use
 * describeMessage() for log lines, never JSON.stringify on raw messages.
 */

import type {
  AckMessage,
  AndroidActionName,
  FrameMessage,
  HelloMessage,
  UplinkMessage,
} from "./types.ts";

let idCounter = 0;

/** Short unique action id (per-process). */
export function newActionId(): string {
  idCounter += 1;
  return `a-${Date.now().toString(36)}-${idCounter}`;
}

/** Encode a downlink action message. */
export function encodeAction(
  id: string,
  action: AndroidActionName,
  params: Record<string, unknown> = {},
): string {
  return JSON.stringify({ type: "action", id, action, params });
}

/** Encode a ping. */
export function encodePing(id: string): string {
  return JSON.stringify({ type: "ping", id });
}

/**
 * Decode one uplink JSON text frame. Throws ProtocolError on malformed
 * input (fail closed — never guess).
 */
export function decodeUplink(text: string): UplinkMessage {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProtocolError("not JSON");
  }
  if (typeof raw !== "object" || raw === null) {
    throw new ProtocolError("message is not an object");
  }
  const msg = raw as Record<string, unknown>;
  switch (msg.type) {
    case "hello":
      return decodeHello(msg);
    case "ack":
      return decodeAck(msg);
    case "frame":
      return decodeFrame(msg);
    case "pong":
      if (typeof msg.id !== "string") throw new ProtocolError("pong missing id");
      return { type: "pong", id: msg.id };
    default:
      throw new ProtocolError(`unknown message type: ${String(msg.type)}`);
  }
}

function requireString(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string") throw new ProtocolError(`expected string for ${key}`);
  return v;
}

function requireNumber(o: Record<string, unknown>, key: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new ProtocolError(`expected finite number for ${key}`);
  }
  return v;
}

function decodeHello(o: Record<string, unknown>): HelloMessage {
  const platform = requireString(o, "platform");
  if (platform !== "android") throw new ProtocolError(`unexpected platform: ${platform}`);
  const capabilities = o.capabilities;
  if (!Array.isArray(capabilities) || !capabilities.every((c) => typeof c === "string")) {
    throw new ProtocolError("hello.capabilities must be string[]");
  }
  return {
    type: "hello",
    device_id: requireString(o, "device_id"),
    platform: "android",
    model: typeof o.model === "string" ? o.model : "",
    width: requireNumber(o, "width"),
    height: requireNumber(o, "height"),
    density_dpi: typeof o.density_dpi === "number" ? o.density_dpi : 0,
    capabilities,
    // Kept in the object for auth comparison; never log it raw.
    token: typeof o.token === "string" ? o.token : "",
  };
}

function decodeAck(o: Record<string, unknown>): AckMessage {
  if (typeof o.ok !== "boolean") throw new ProtocolError("ack.ok must be boolean");
  return {
    type: "ack",
    id: requireString(o, "id"),
    ok: o.ok,
    latency_ms: typeof o.latency_ms === "number" ? o.latency_ms : -1,
    error: o.error == null ? null : String(o.error),
    data:
      o.data != null && typeof o.data === "object"
        ? (o.data as Record<string, unknown>)
        : null,
  };
}

function decodeFrame(o: Record<string, unknown>): FrameMessage {
  return {
    type: "frame",
    seq: requireNumber(o, "seq"),
    ts: requireNumber(o, "ts"),
    width: requireNumber(o, "width"),
    height: requireNumber(o, "height"),
    format: "jpeg",
    jpeg_b64: requireString(o, "jpeg_b64"),
  };
}

export class ProtocolError extends Error {
  constructor(message: string) {
    super(`protocol: ${message}`);
    this.name = "ProtocolError";
  }
}

/**
 * One-line, secret-free description of an uplink message for logs.
 * hello.token is reduced to present/absent — never printed.
 */
export function describeMessage(msg: UplinkMessage): string {
  switch (msg.type) {
    case "hello":
      return `hello device_id=${msg.device_id} model=${msg.model} ` +
        `${msg.width}x${msg.height} token=${msg.token ? "present" : "absent"}`;
    case "ack":
      return `ack id=${msg.id} ok=${msg.ok}${msg.error ? ` error=${msg.error}` : ""}`;
    case "frame":
      return `frame seq=${msg.seq} ${msg.width}x${msg.height}`;
    case "pong":
      return `pong id=${msg.id}`;
    default: {
      // Unreachable if UplinkMessage stays closed; never throw on the wire.
      const _exhaustive: never = msg;
      return `unknown message (${typeof _exhaustive})`;
    }
  }
}
