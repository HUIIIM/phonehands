// MIT License — Copyright (c) 2026 Ehsan
// Adapted from ios_mcp/wda/client.py in emazaheri/ios-agent
// (MIT; full text in packages/device-backend/NOTICE.md,
// license status pending GC final ruling).
//
// phonehands modifications:
//  - Ported to TypeScript over sync node:http (no httpx).
//  - Timeout mapping DIVERGES from upstream: upstream maps read-timeouts
//    to RunnerCrashed (recoverable -> auto-heal retries). We map them to
//    ActionTimeout (NOT recoverable), because a timed-out mutating action
//    is ambiguous and MV427 forbids replaying it. Same for mid-flight
//    socket death -> ConnectionLost (not recoverable).
//    Only "connection refused" (runner never reached) stays RunnerCrashed.
//  - Loopback enforcement is NOT done here; the DeviceBackend constructor
//    rejects non-loopback base URLs before a transport is created.

/**
 * Low-level WebDriverAgent HTTP client.
 *
 * Owns the transport concerns only: request/response envelopes, WDA's
 * error vocabulary, and timeouts. Session semantics live in session.ts.
 */

import http from "node:http";

import {
  ActionTimeout,
  AppNotFound,
  AutomationError,
  type AutomationErrorOptions,
  ConnectionLost,
  DeviceLocked,
  ElementNotFound,
  ElementNotInteractable,
  ElementStale,
  RunnerCrashed,
  SessionLost,
  UnexpectedAlert,
  WdaError,
} from "./errors.ts";

export interface TransportOptions {
  /** Per-request timeout in ms. Default 10_000. */
  requestTimeoutMs?: number;
  /** TCP connect timeout in ms. Default 3_000. */
  connectTimeoutMs?: number;
}

/** WDA speaks the W3C WebDriver error vocabulary, with a few additions. */
type ErrorCtor = new (msg: string, opts: AutomationErrorOptions) => AutomationError;
const ERROR_MAP: Record<string, ErrorCtor> = {
  "no such element": ElementNotFound,
  "no such alert": WdaError,
  "stale element reference": ElementStale,
  "invalid element state": ElementNotInteractable,
  "element not interactable": ElementNotInteractable,
  "element not visible": ElementNotInteractable,
  "unexpected alert open": UnexpectedAlert,
  "invalid session id": SessionLost,
  "no such window": SessionLost,
  "session not created": SessionLost,
};

const HINTS: Record<string, string> = {
  "no such element": "Re-observe to see what is actually on screen.",
  "stale element reference":
    "The screen changed since the last observation. Re-observe and use a fresh ref.",
  "invalid element state": "The element is disabled or off-screen. Scroll it into view first.",
  "element not interactable":
    "The element is covered or off-screen. Scroll it into view, or dismiss an overlay.",
  "unexpected alert open": "Handle the alert, then retry.",
  "invalid session id": "The session died. It will be recreated automatically.",
};

const MISSING_APP_MARKERS = ["fbsapplicationlibrary", "application info provider"];

export class WdaTransport {
  readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly connectTimeoutMs: number;

  constructor(baseUrl: string, options: TransportOptions = {}) {
    // baseUrl is validated loopback-only by DeviceBackend before this runs.
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 3_000;
  }

  /**
   * Issue one request and unwrap WDA's {"value": ...} envelope.
   * Exactly one attempt. Never retries.
   */
  async request(
    method: string,
    path: string,
    json: Record<string, unknown> | null = null,
    timeoutMs?: number,
  ): Promise<unknown> {
    const url = new URL(path, this.baseUrl + "/");
    const body = json === null ? null : JSON.stringify(json);
    const timeout = timeoutMs ?? this.requestTimeoutMs;

    let result: { status: number; body: string };
    try {
      result = await this.rawRequest(url, method, body, timeout);
    } catch (err) {
      throw classifyTransportError(err, method, path, this.baseUrl);
    }
    return unwrap(result.status, result.body, method, path);
  }

  private rawRequest(
    url: URL,
    method: string,
    body: string | null,
    timeoutMs: number,
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      let done = false;
      // No socket pooling (agent: false): every request is an independent
      // attempt on a fresh socket. A pooled stale socket would turn a
      // dead runner into ECONNRESET (ambiguous) instead of ECONNREFUSED
      // (runner never saw it) — exactly the distinction auto-heal
      // depends on.
      const req = http.request(
        url,
        {
          method,
          agent: false,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(body !== null ? { "Content-Length": Buffer.byteLength(body) } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () =>
            finish(() =>
              resolve({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            ),
          );
          res.on("error", (err) => finish(() => reject(err)));
        },
      );
      const finish = (fn: () => void): void => {
        if (done) return;
        done = true;
        clearTimeout(connectTimer);
        clearTimeout(requestTimer);
        fn();
      };
      // Connect timeout: socket never established -> runner never saw it.
      const connectTimer = setTimeout(() => {
        finish(() =>
          reject(
            Object.assign(
              new Error(`connect timeout after ${this.connectTimeoutMs}ms`),
              { code: "ETIMEDOUT", phase: "connect" },
            ),
          ),
        );
        req.destroy();
      }, this.connectTimeoutMs);
      req.on("socket", (socket) => {
        // Fresh socket per request (agent: false), so "connect" always
        // fires exactly once; guard anyway against reuse.
        if (socket.connecting === false) {
          clearTimeout(connectTimer);
        } else {
          socket.once("connect", () => clearTimeout(connectTimer));
        }
      });
      // Request timeout: established but no complete response in time.
      const requestTimer = setTimeout(() => {
        finish(() =>
          reject(
            Object.assign(new Error(`request timeout after ${timeoutMs}ms`), {
              code: "ETIMEDOUT",
              phase: "request",
            }),
          ),
        );
        req.destroy();
      }, timeoutMs);
      req.on("error", (err) => finish(() => reject(err)));
      if (body !== null) req.write(body);
      req.end();
    });
  }

  async get(path: string, timeoutMs?: number): Promise<unknown> {
    return this.request("GET", path, null, timeoutMs);
  }

  async post(
    path: string,
    json: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<unknown> {
    return this.request("POST", path, json, timeoutMs);
  }

  async delete(path: string, timeoutMs?: number): Promise<unknown> {
    return this.request("DELETE", path, null, timeoutMs);
  }

  /** GET /status — liveness probe. */
  async isAlive(): Promise<boolean> {
    try {
      await this.get("/status", this.connectTimeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  /** Screenshots come back base64-encoded regardless of endpoint. */
  async screenshotPng(sessionId?: string): Promise<Buffer> {
    const path = sessionId ? `/session/${sessionId}/screenshot` : "/screenshot";
    const encoded = await this.get(path);
    if (typeof encoded !== "string") {
      throw new WdaError("Screenshot response was not a base64 string");
    }
    return Buffer.from(encoded, "base64");
  }
}

/**
 * Maps node-level transport failures to the typed vocabulary.
 *
 * The MV427-critical distinction:
 *  - ECONNREFUSED / connect-timeout  -> RunnerCrashed (recoverable):
 *    the runner never saw the request, so healing + one retry is safe.
 *  - request timeout / mid-flight reset -> ActionTimeout / ConnectionLost
 *    (NOT recoverable): the device may have executed the action.
 *    Never auto-replay a mutating action on these.
 */
export function classifyTransportError(
  err: unknown,
  method: string,
  path: string,
  baseUrl: string,
): AutomationError {
  const e = err as { code?: string; message?: string; phase?: string };
  const code = e?.code ?? "";
  const phase = e?.phase ?? "";
  const message = e?.message ?? String(err);

  if (code === "ECONNREFUSED") {
    return new RunnerCrashed(`Cannot reach WebDriverAgent at ${baseUrl}`, {
      hint: "The runner process is not listening. It usually needs restarting.",
    });
  }
  if (/timeout|timed out|ETIMEDOUT/i.test(code + " " + message)) {
    if (phase === "connect") {
      return new RunnerCrashed(`Cannot reach WebDriverAgent at ${baseUrl} (connect timeout)`, {
        hint: "The runner process is not listening. It usually needs restarting.",
      });
    }
    return new ActionTimeout(`WebDriverAgent timed out on ${method} ${path}`, {
      hint:
        "Ambiguous: the device may have executed the action. " +
        "Observe the actual state before deciding — never blind-replay.",
    });
  }
  if (/ECONNRESET|EPIPE|socket hang up|socket destroyed/i.test(code + " " + message)) {
    return new ConnectionLost(`Lost connection to WebDriverAgent on ${method} ${path}`, {
      hint:
        "Ambiguous: the request was sent but the response was lost. " +
        "Observe the actual state before deciding — never blind-replay.",
    });
  }
  return new WdaError(`HTTP failure on ${method} ${path}: ${message}`, {
    recoverable: true,
  });
}

/** Unwrap WDA's response envelope into a value or a typed error. */
function unwrap(
  status: number,
  body: string,
  method: string,
  path: string,
): unknown {
  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    if (status >= 200 && status < 300) return body;
    throw new WdaError(
      `WebDriverAgent returned HTTP ${status} with a non-JSON body`,
      { details: { body: body.slice(0, 300) } },
    );
  }

  const value =
    typeof payload === "object" && payload !== null && "value" in payload
      ? (payload as { value: unknown }).value
      : payload;

  // W3C shape: an error is an object carrying an "error" key.
  if (typeof value === "object" && value !== null && "error" in value) {
    throw toError(value as Record<string, unknown>, method, path);
  }

  // Legacy shape: a non-zero top-level "status".
  if (
    typeof payload === "object" &&
    payload !== null &&
    "status" in payload &&
    (payload as { status: unknown }).status !== 0 &&
    (payload as { status: unknown }).status !== undefined
  ) {
    throw new WdaError(String(messageOf(value) ?? (payload as { status: unknown }).status), {
      details: { status: (payload as { status: unknown }).status },
    });
  }

  if (status < 200 || status >= 300) {
    throw new WdaError(`WebDriverAgent returned HTTP ${status} on ${method} ${path}`, {
      details: { body: String(payload).slice(0, 300) },
    });
  }
  return value;
}

function toError(
  value: Record<string, unknown>,
  method: string,
  path: string,
): AutomationError {
  const kind = String(value["error"] ?? "").trim().toLowerCase();
  const message = messageOf(value) ?? `${method} ${path} failed`;

  // A locked phone is the commonest real-device failure, and WDA reports
  // it as a wall of Apple error domains rather than anything typed.
  if (isLocked(message)) {
    return new DeviceLocked("The device is locked", {
      hint: "Unlock the phone and keep it awake.",
    });
  }

  const missing = missingApp(message);
  if (missing !== null) {
    return new AppNotFound(`No app with bundle id ${JSON.stringify(missing)} is installed`, {
      hint: "Check the id.",
      details: { bundle_id: missing },
    });
  }

  const Cls = ERROR_MAP[kind] ?? WdaError;
  const recoverable =
    Cls === SessionLost || Cls === ElementStale || Cls === RunnerCrashed;
  return new Cls(message, {
    hint: HINTS[kind],
    details: { wda_error: kind },
    recoverable,
  });
}

function messageOf(value: unknown): string | null {
  if (typeof value === "object" && value !== null) {
    const v = value as Record<string, unknown>;
    const m = v["message"] ?? v["description"];
    if (m) return String(m).split("\n")[0]?.slice(0, 600) ?? null;
  }
  return null;
}

function isLocked(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("could not be, unlocked") ||
    (lowered.includes("passcode") && lowered.includes("locked"))
  );
}

function missingApp(message: string): string | null {
  const lowered = message.toLowerCase();
  if (!lowered.includes("failed") || !MISSING_APP_MARKERS.some((m) => lowered.includes(m))) {
    return null;
  }
  const found = /to open "?([A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+)"?/.exec(message);
  return found?.[1] ?? null;
}
