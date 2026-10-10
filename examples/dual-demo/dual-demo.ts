// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)
//
// phonehands · examples/dual-demo — "API died, the task didn't"
// ==========================================================
// One script, both engines. Demo video script A (see proposal §4.2):
//   Phase 1 — read 20 matches through the FAST api engine (mock).
//   Phase 2 — mock server flips to 403 (endpoint changed, like a real
//             app update); the Router auto-degrades to the device engine
//             (mock WDA) and the SAME script keeps reading.
// Everything here is a MOCK: no real network, no real device,
// no real account. Integration will swap the mocks for the real
// @phonehands/api-backend and @phonehands/device-backend (same envelope).
//
// Contract (mirrors packages/core README):
//   envelope = { ok, backend: "api" | "device", latency_ms, degraded, evidence }
//
// Run:   node dual-demo.ts
// Test:  node --test dual-demo.test.ts

import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// 1. Contract types (mirror @phonehands/core)
// ---------------------------------------------------------------------------

export type Backend = "api" | "device";

export interface ResultEnvelope<T = unknown> {
  ok: boolean;
  backend: Backend;
  latency_ms: number;
  degraded: boolean;
  evidence: T;
}

export interface Match {
  id: string;
  name: string;
  lastMessage: string;
  matchedAt: string;
}

export type ApiMode = "ok" | "403";

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 2. Deterministic fixture: 20 matches (shared by both mocks so the demo
//    reads the same data on either engine — "the task didn't die").
// ---------------------------------------------------------------------------

const FIXTURE_NAMES: string[] = [
  "Amara O.", "Ben K.", "Chloe Z.", "Daniel R.", "Elena M.",
  "Felix T.", "Grace L.", "Hugo P.", "Iris W.", "Jonas S.",
  "Kira N.", "Leo F.", "Maya D.", "Noah B.", "Olivia H.",
  "Priya V.", "Quinn J.", "Rosa C.", "Sam E.", "Tara G.",
];

const FIXTURE_MESSAGES: string[] = [
  "hey! how's your week going?",
  "that hiking photo is amazing — where was it?",
  "lol finally someone who gets the joke",
  "coffee this weekend?",
  "your dog is adorable, what's their name?",
  "so… team pineapple pizza or no?",
  "just got back from Lisbon, you have to go",
  "are you more of a morning person?",
  "that book on your shelf — good?",
  "ok but your taste in music needs work",
];

export function makeMatches(): Match[] {
  return FIXTURE_NAMES.map((name, i) => ({
    id: `match-${String(i + 1).padStart(3, "0")}`,
    name,
    lastMessage: FIXTURE_MESSAGES[i % FIXTURE_MESSAGES.length],
    matchedAt: `2026-10-${String(1 + (i % 8)).padStart(2, "0")}T1${i % 10}:00:00Z`,
  }));
}

// ---------------------------------------------------------------------------
// 3. MOCK: Hinge-style HTTP API server (the "api engine" target)
//    Flip between healthy and "app updated, endpoint gone" (403) modes.
// ---------------------------------------------------------------------------

export interface ApiReadResult {
  status: number;
  requestId: string;
  matches?: Match[];
  error?: string;
  errorDetail?: string;
}

export class MockHingeApiServer {
  private mode: ApiMode = "ok";
  private readonly matches: Match[] = makeMatches();
  private requestSeq = 0;

  setMode(mode: ApiMode): void {
    this.mode = mode;
  }

  getMode(): ApiMode {
    return this.mode;
  }

  async readMatches(limit: number): Promise<ApiReadResult> {
    const requestId = `mock-req-${++this.requestSeq}`;
    await sleep(2); // negligible local delay — still "milliseconds fast"
    if (this.mode === "403") {
      return {
        status: 403,
        requestId,
        error: "ENDPOINT_REMOVED",
        errorDetail: "This endpoint is no longer supported. Please update the app.",
      };
    }
    return { status: 200, requestId, matches: this.matches.slice(0, limit) };
  }
}

// ---------------------------------------------------------------------------
// 4. MOCK: WebDriverAgent server (the "device engine" target)
//    observe() returns an accessibility tree; the device backend parses it.
// ---------------------------------------------------------------------------

export interface WdaNode {
  type: string;
  label?: string;
  children?: WdaNode[];
}

export interface WdaObserveResult {
  tree: WdaNode;
  screenshot: string;
  nodeCount: number;
}

export class MockWdaServer {
  private readonly matches: Match[] = makeMatches();
  public observeCallCount = 0;

  private buildTree(): WdaNode {
    return {
      type: "XCUIElementTypeApplication",
      label: "Hinge",
      children: [
        {
          type: "XCUIElementTypeWindow",
          children: [
            {
              type: "XCUIElementTypeTable",
              label: "Matches",
              children: this.matches.map((m) => ({
                type: "XCUIElementTypeCell",
                label: m.name,
                children: [
                  { type: "XCUIElementTypeStaticText", label: m.name },
                  { type: "XCUIElementTypeStaticText", label: m.lastMessage },
                ],
              })),
            },
          ],
        },
      ],
    };
  }

  async observe(): Promise<WdaObserveResult> {
    this.observeCallCount++;
    await sleep(2);
    const tree = this.buildTree();
    return {
      tree,
      screenshot: "mock-screenshot-placeholder",
      nodeCount: 3 + this.matches.length * 3,
    };
  }

  async tap(x: number, y: number): Promise<{ ok: true }> {
    await sleep(2);
    void x;
    void y;
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// 5. Backends — both speak the same envelope language.
//    evidence = Match[] on success, so the caller never cares which engine ran.
// ---------------------------------------------------------------------------

export interface BackendOptions {
  /** Simulated round-trip latency. Demo default: realistic random; tests inject fixed values. */
  latencyMs?: () => number;
}

const defaultApiLatency = (): number => 60 + Math.random() * 80; // ~60–140ms
const defaultDeviceLatency = (): number => 380 + Math.random() * 470; // ~380–850ms

export class ApiBackend {
  private readonly server: MockHingeApiServer;
  private readonly opts: BackendOptions;

  constructor(server: MockHingeApiServer, opts: BackendOptions = {}) {
    this.server = server;
    this.opts = opts;
  }

  async readMatches(limit: number): Promise<ResultEnvelope<Match[]>> {
    const t0 = Date.now();
    await sleep((this.opts.latencyMs ?? defaultApiLatency)());
    const res = await this.server.readMatches(limit);
    return {
      ok: res.status === 200,
      backend: "api",
      latency_ms: Date.now() - t0,
      degraded: false,
      evidence: res.status === 200 ? (res.matches as Match[]) : [],
    };
  }
}

export class DeviceBackend {
  private readonly wda: MockWdaServer;
  private readonly opts: BackendOptions;

  constructor(wda: MockWdaServer, opts: BackendOptions = {}) {
    this.wda = wda;
    this.opts = opts;
  }

  async readMatches(limit: number): Promise<ResultEnvelope<Match[]>> {
    const t0 = Date.now();
    await sleep((this.opts.latencyMs ?? defaultDeviceLatency)());
    // Tree-first parse (per device-backend README): read names/messages
    // straight out of the accessibility tree, no OCR needed here.
    const { tree, nodeCount } = await this.wda.observe();
    const table = tree.children?.[0]?.children?.[0];
    const cells = table?.children ?? [];
    const matches: Match[] = cells.slice(0, limit).map((cell, i) => ({
      id: `match-${String(i + 1).padStart(3, "0")}`,
      name: cell.label ?? `unknown-${i}`,
      lastMessage: cell.children?.[1]?.label ?? "",
      matchedAt: "",
    }));
    void nodeCount; // surfaced in the router log line via evidence count
    return {
      ok: true,
      backend: "device",
      latency_ms: Date.now() - t0,
      degraded: true, // device reads only happen post-degradation in this demo
      evidence: matches,
    };
  }
}

// ---------------------------------------------------------------------------
// 6. Router — reads go to API; consecutive 4xx degrades to device.
// ---------------------------------------------------------------------------

export interface RouterOptions {
  /** Consecutive 4xx before marking degraded. Demo default 1 (crisp 30s story); production: 3. */
  degradeAfter4xx?: number;
}

export interface AttemptLog {
  action: string;
  backend: string;
  latency_ms: number;
  degraded: boolean;
  ok: boolean;
  extra?: string;
}

export type LogFn = (entry: AttemptLog) => void;

/** Uniform log line: action / backend / latency_ms / degraded (+ ok). */
export const defaultLog: LogFn = (e: AttemptLog): void => {
  const parts = [
    `action=${e.action}`,
    `backend=${e.backend}`,
    `latency_ms=${e.latency_ms}`,
    `degraded=${e.degraded}`,
    `ok=${e.ok}`,
  ];
  if (e.extra) parts.push(e.extra);
  console.log(parts.join(" "));
};

export class Router {
  private api4xxStreak = 0;
  private degraded = false;
  private readonly threshold: number;
  private readonly api: ApiBackend;
  private readonly device: DeviceBackend;
  private readonly log: LogFn;

  constructor(api: ApiBackend, device: DeviceBackend, log: LogFn = defaultLog, opts: RouterOptions = {}) {
    this.api = api;
    this.device = device;
    this.log = log;
    this.threshold = opts.degradeAfter4xx ?? 1;
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  async readMatches(limit: number): Promise<ResultEnvelope<Match[]>> {
    // Default route: reads → API (fast).
    if (!this.degraded) {
      const attempt = await this.api.readMatches(limit);
      const is4xx = !attempt.ok; // mock API only fails with 403; real impl checks status band
      if (is4xx) this.api4xxStreak++;
      else this.api4xxStreak = 0;

      const willDegrade = is4xx && this.api4xxStreak >= this.threshold;
      this.log({
        action: "read_matches",
        backend: "api",
        latency_ms: attempt.latency_ms,
        degraded: willDegrade,
        ok: attempt.ok,
        extra: is4xx ? "error=HTTP_403_ENDPOINT_REMOVED" : `matches=${attempt.evidence.length}`,
      });

      if (attempt.ok) return attempt;

      if (willDegrade) {
        this.degraded = true;
        this.log({
          action: "router_degrade",
          backend: "api->device",
          latency_ms: 0,
          degraded: true,
          ok: true,
          extra: `reason=4xx_streak>=${this.threshold}`,
        });
      } else {
        return attempt; // below threshold: surface the failure, do not degrade yet
      }
    }

    // Degraded route: everything → device.
    const dev = await this.device.readMatches(limit);
    this.log({
      action: "read_matches",
      backend: "device",
      latency_ms: dev.latency_ms,
      degraded: true,
      ok: dev.ok,
      extra: `matches=${dev.evidence.length} source=accessibility-tree`,
    });
    return dev;
  }
}

// ---------------------------------------------------------------------------
// 7. Demo script — "API died, the task didn't"
// ---------------------------------------------------------------------------

function banner(title: string): void {
  console.log(`\n--- ${title} ---`);
}

function printEnvelope(label: string, env: ResultEnvelope<Match[]>): void {
  console.log(`${label} =>`);
  console.log(
    JSON.stringify(
      {
        ok: env.ok,
        backend: env.backend,
        latency_ms: env.latency_ms,
        degraded: env.degraded,
        evidence: `[${env.evidence.length} matches — first: ${env.evidence[0]?.name ?? "none"}]`,
      },
      null,
      2,
    ),
  );
}

export async function runDemo(): Promise<void> {
  console.log('=== phonehands dual-demo: "API died, the task didn\'t" ===');
  console.log(
    "[mocks only: MockHingeApiServer + MockWdaServer — no real network, no real device, no real account]",
  );

  const apiServer = new MockHingeApiServer();
  const wda = new MockWdaServer();
  const router = new Router(new ApiBackend(apiServer), new DeviceBackend(wda));

  // ---- Phase 1: API healthy ------------------------------------------------
  banner("PHASE 1 — API engine healthy: read 20 matches");
  const env1 = await router.readMatches(20);
  console.log(`sample: ${env1.evidence[0].name} · "${env1.evidence[0].lastMessage}"`);
  console.log(`sample: ${env1.evidence[1].name} · "${env1.evidence[1].lastMessage}"`);
  console.log(`sample: ${env1.evidence[2].name} · "${env1.evidence[2].lastMessage}"`);
  printEnvelope("envelope", env1);

  // ---- Simulation: the app updates, the endpoint dies -----------------------
  banner("SIMULATION — Hinge ships a new app version; old endpoint returns 403");
  apiServer.setMode("403");
  console.log("[mock server] mode: ok -> 403");

  // ---- Phase 2: same script, automatic degradation --------------------------
  banner("PHASE 2 — same script keeps reading; router degrades to device engine");
  const env2 = await router.readMatches(20);
  console.log(`device read sample: ${env2.evidence[0].name} · "${env2.evidence[0].lastMessage}"`);
  printEnvelope("envelope", env2);

  // ---- Phase 2b: the task continues -----------------------------------------
  banner("PHASE 2b — task continues on the device engine");
  const env3 = await router.readMatches(20);
  console.log(
    `still reading: ${env3.evidence.length} matches via ${env3.backend} (degraded=${env3.degraded})`,
  );

  banner("RESULT");
  console.log(
    "60 matches read across 3 calls. API died; the task didn't. （接口会变，手不会。）",
  );
}

// Run the demo only when executed directly (not when imported by tests).
const isMain = ((): boolean => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  runDemo().catch((err: unknown) => {
    console.error("demo failed:", err);
    process.exit(1);
  });
}
