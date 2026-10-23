// SPDX-License-Identifier: BUSL-1.1

/**
 * Mock WDA server for tests. Runs on 127.0.0.1 with an ephemeral port.
 *
 * Implements the WDA subset the client needs:
 *   POST   /session
 *   DELETE /session/:id
 *   GET    /status
 *   POST   /session/:id/wda/tap            (records call)
 *   POST   /session/:id/wda/touchAndHold   (records call)
 *   POST   /session/:id/wda/dragfromtoforduration (records call)
 *   POST   /session/:id/keys               (records call)
 *   GET    /session/:id/source              (fixed tree fixture)
 *   GET    /session/:id/screenshot          (1x1 PNG)
 *   GET    /session/:id/window/size         (390x844)
 *
 * Route behaviors ("ok" | "hang" | "drop") let tests simulate
 * timeouts and disconnects deterministically:
 *   hang = never responds (client timeout fires)
 *   drop = destroys the socket immediately (connection_lost)
 *
 * This is a TEST DOUBLE. It is not a WDA implementation and must
 * never be used against a real device.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  FIXTURE_TREE_XML,
  FIXTURE_WINDOW_SIZE,
  makePngBytes,
} from "./fixtures.ts";

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
  ts: number;
}

export type RouteBehavior = "ok" | "hang" | "drop";

export interface InjectedFailure {
  pathFragment: string;
  errorKind: string; // W3C error, e.g. "invalid session id"
}

type RouteKey =
  | "session"
  | "sessionDelete"
  | "status"
  | "tap"
  | "touchAndHold"
  | "swipe"
  | "type"
  | "source"
  | "screenshot"
  | "windowSize"
  | "appiumSettings"
  | "appsLaunch"
  | "appsActivate";

function routeKeyFor(method: string, pathname: string): RouteKey | null {
  if (method === "POST" && pathname === "/session") return "session";
  if (method === "DELETE" && pathname.startsWith("/session/")) return "sessionDelete";
  if (pathname === "/status") return "status";
  if (pathname.endsWith("/wda/tap")) return "tap";
  if (pathname.endsWith("/wda/touchAndHold")) return "touchAndHold";
  if (pathname.endsWith("/wda/dragfromtoforduration")) return "swipe";
  if (pathname.endsWith("/keys")) return "type";
  if (pathname.endsWith("/source")) return "source";
  if (pathname.endsWith("/screenshot")) return "screenshot";
  if (pathname.endsWith("/window/size")) return "windowSize";
  if (pathname.endsWith("/appium/settings")) return "appiumSettings";
  if (pathname.endsWith("/wda/apps/launch")) return "appsLaunch";
  if (pathname.endsWith("/wda/apps/activate")) return "appsActivate";
  return null;
}

export class MockWdaServer {
  readonly calls: RecordedCall[] = [];
  /** When non-null, GET /source returns this XML instead of the fixture
   *  (used to simulate empty/malformed trees). */
  sourceOverride: string | null = null;
  /** Sessions created since the last reset (auto-heal accounting). */
  sessionsCreated = 0;
  /** Last payload POSTed to /appium/settings (snapshot tuning). */
  settingsApplied: unknown = null;
  /** Bundle id currently in the foreground (tracked via launch). */
  activeBundle: string | null = null;
  /** One-shot WDA error injections, consumed FIFO. */
  private readonly failures: InjectedFailure[] = [];
  /** Screenshot bytes returned by GET /screenshot. Defaults to a real
   *  1170x2532 PNG (3x of the 390x844 logical frame) so pixel-mapping
   *  tests exercise a consistent geometry. */
  screenshotPng: Buffer = makePngBytes(1170, 2532);
  private readonly behaviors = new Map<RouteKey, RouteBehavior>();
  private server: http.Server | null = null;
  private port = 0;

  /** Override the behavior of one route for the next requests. */
  setBehavior(route: RouteKey, behavior: RouteBehavior): void {
    this.behaviors.set(route, behavior);
  }

  resetBehavior(): void {
    this.behaviors.clear();
  }

  resetCalls(): void {
    this.calls.length = 0;
  }

  /** Inject a one-shot WDA error for the next request whose path contains the fragment. */
  failNext(pathFragment: string, errorKind: string): void {
    this.failures.push({ pathFragment, errorKind });
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<number> {
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    this.port = (this.server.address() as AddressInfo).port;
    return this.port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.server === null) return resolve();
      this.server.close(() => resolve());
    });
    this.server = null;
  }

  private async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const method = req.method ?? "GET";
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const key = routeKeyFor(method, pathname);
    const behavior = (key !== null ? this.behaviors.get(key) : undefined) ?? "ok";

    // Record the attempt BEFORE applying hang/drop, so tests can assert
    // the client made exactly one attempt (no blind retry).
    const rec: RecordedCall = { method, path: pathname, body: null, ts: Date.now() };
    this.calls.push(rec);

    if (behavior === "drop") {
      req.resume(); // drain
      req.socket.destroy();
      return;
    }
    if (behavior === "hang") {
      req.resume(); // drain; never respond — the client's timeout fires
      return;
    }

    const body = await readBody(req);
    rec.body = body;

    // One-shot injected failures take precedence (consumed FIFO).
    const failureIdx = this.failures.findIndex((f) => pathname.includes(f.pathFragment));
    if (failureIdx >= 0) {
      const [failure] = this.failures.splice(failureIdx, 1);
      this.json(res, 404, {
        value: { error: failure?.errorKind, message: `${failure?.errorKind} (injected)` },
      });
      return;
    }

    if (key === null) {
      this.json(res, 404, { value: null, status: 6 });
      return;
    }
    switch (key) {
      case "session":
        this.sessionsCreated += 1;
        this.json(res, 200, {
          value: { sessionId: `mock-session-${this.sessionsCreated}`, capabilities: {} },
          status: 0,
        });
        break;
      case "sessionDelete":
      case "tap":
      case "touchAndHold":
      case "swipe":
      case "type":
      case "status":
        this.json(res, 200, { value: null, status: 0 });
        break;
      case "source":
        this.json(res, 200, { value: this.sourceOverride ?? FIXTURE_TREE_XML, status: 0 });
        break;
      case "screenshot":
        this.json(res, 200, {
          value: this.screenshotPng.toString("base64"),
          status: 0,
        });
        break;
      case "windowSize":
        this.json(res, 200, { value: FIXTURE_WINDOW_SIZE, status: 0 });
        break;
      case "appiumSettings":
        this.settingsApplied = body;
        this.json(res, 200, { value: null, status: 0 });
        break;
      case "appsLaunch": {
        const bundleId = (body as { bundleId?: string } | null)?.bundleId ?? null;
        this.activeBundle = bundleId;
        this.json(res, 200, { value: null, status: 0 });
        break;
      }
      case "appsActivate": {
        const bundleId = (body as { bundleId?: string } | null)?.bundleId ?? null;
        this.activeBundle = bundleId;
        this.json(res, 200, { value: null, status: 0 });
        break;
      }
    }
  }

  private json(res: http.ServerResponse, status: number, payload: unknown): void {
    const text = JSON.stringify(payload);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(text),
    });
    res.end(text);
  }
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve(null);
      try {
        resolve(JSON.parse(text) as unknown);
      } catch {
        resolve(text);
      }
    });
    req.on("error", () => resolve(null));
  });
}
