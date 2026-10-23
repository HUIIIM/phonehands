// SPDX-License-Identifier: BUSL-1.1

/**
 * DeviceBackend — the phonehands device engine, built on the WdaSession base.
 *
 * Architecture (from emazaheri/ios-agent, MIT):
 *   transport (HTTP) -> session (lifecycle + auto-heal) -> backend (envelope)
 * Upper layers program against the DeviceAdapter protocol and never
 * branch on device kind; the Router picks backends by capability table.
 *
 * Redlines enforced HERE (never in the session layer):
 *  1. loopback-only: non-loopback base URLs are rejected at construction.
 *  2. Degrade chain: observe() is tree-first; an empty/malformed/
 *     unreachable tree falls back to a screenshot with
 *     tree_unavailable=true. Exactly one attempt per step, no blind retry.
 *  3. Never replay uncertain: ActionTimeout / ConnectionLost on a
 *     mutating action return ok:false + uncertain:true. Auto-heal replays
 *     ONLY SessionLost and connection-refused RunnerCrashed, where the
 *     action provably never executed — and then reports recovered:true.
 *  4. Audit log is redacted by construction (no coords/text/tree/bytes).
 */

import { performance } from "node:perf_hooks";

import { WdaSession, type SessionOptions } from "./wda/session.ts";
import {
  ActionTimeout,
  AutomationError,
  ConnectionLost,
  RunnerCrashed,
  SessionLost,
} from "./wda/errors.ts";
import { assertLoopbackUrl } from "./loopback-guard.ts";
import { parseAccessibilityTree } from "./tree.ts";
import { recordAudit } from "./audit.ts";
import { screenshotToTapPoint, type NormalizedBox, type ScreenshotOrientation } from "./fallback.ts";
import type { DeviceAdapter, DeviceInfo } from "./device-adapter.ts";
import type { DeviceEnvelope, UiTree, WdaClientOptions } from "./types.ts";

export interface DeviceBackendOptions extends WdaClientOptions {
  session?: SessionOptions;
  deviceName?: string;
}

export class DeviceBackend implements DeviceAdapter {
  readonly info: DeviceInfo;
  private readonly session: WdaSession;
  private lastUsableTree: UiTree | null = null;

  constructor(options: DeviceBackendOptions) {
    // Redline: loopback-only, checked before any socket exists.
    const url = assertLoopbackUrl(options.baseUrl);
    this.info = {
      name: options.deviceName ?? "iphone",
      baseUrl: url.toString().replace(/\/+$/, ""),
    };
    this.session = new WdaSession(this.info.baseUrl, {
      ...options.session,
      transport: {
        ...options.session?.transport,
        ...(options.requestTimeoutMs !== undefined
          ? { requestTimeoutMs: options.requestTimeoutMs }
          : {}),
      },
    });
  }

  // -- lifecycle ---------------------------------------------------------

  async connect(): Promise<DeviceEnvelope> {
    return this.envelope("connect", false, async () => {
      const sessionId = await this.session.open();
      return { sessionId };
    });
  }

  async disconnect(): Promise<DeviceEnvelope> {
    return this.envelope("disconnect", false, async () => {
      await this.session.close();
      return {};
    });
  }

  async health(): Promise<DeviceEnvelope> {
    return this.envelope("health", false, async () => {
      // Liveness without side effects: a cheap window/size read.
      await this.session.windowSize();
      return {};
    });
  }

  get recoveredCount(): number {
    return this.session.recoveredCount;
  }

  // -- observe: the degrade chain ----------------------------------------

  /**
   * Tree-first. If the tree is empty/malformed/unreachable, fall back to
   * a screenshot with tree_unavailable=true. The caller owns pixel
   * locating (see fallback.ts); this method never blind-retries.
   */
  async observe(): Promise<DeviceEnvelope> {
    const startedAt = performance.now();
    const evidence: Record<string, unknown> = { action: "observe" };
    let recovered = false;
    try {
      const { xml, recovered: r } = await this.session.sourceXml();
      recovered = r;
      const tree = parseAccessibilityTree(xml);
      // A tree holding only the application root carries no actionable
      // elements (the hollow-tree case, e.g. self-drawn UIs) — treat it
      // as empty and fall back to the screenshot.
      if (tree !== null && tree.nodes.length > 1) {
        this.lastUsableTree = tree;
        evidence["tree"] = tree;
        evidence["nodeCount"] = tree.nodes.length;
        if (recovered) evidence["recovered"] = true;
        return this.done("observe", true, false, evidence, startedAt);
      }
      evidence["tree_error"] = "empty_or_malformed_tree";
    } catch (err) {
      if (err instanceof ActionTimeout || err instanceof ConnectionLost) {
        evidence["tree_error"] = err.code;
      } else {
        // SessionLost / RunnerCrashed were already healed inside session.call;
        // anything else is a hard failure of the read path.
        evidence["tree_error"] = err instanceof AutomationError ? err.code : "unknown";
      }
    }

    evidence["tree_unavailable"] = true;
    try {
      const { bytes, recovered: r2 } = await this.session.screenshotBytes();
      evidence["screenshot"] = bytes;
      evidence["screenshotBytes"] = bytes.length;
      if (recovered || r2) evidence["recovered"] = true;
      return this.done("observe", true, true, evidence, startedAt);
    } catch (err) {
      evidence["screenshot_error"] =
        err instanceof AutomationError ? err.code : "unknown";
      return this.done("observe", false, true, evidence, startedAt);
    }
  }

  // -- mutating actions: never replay uncertain --------------------------

  async tap(x: number, y: number): Promise<DeviceEnvelope> {
    return this.envelope("tap", false, async () => {
      const recovered = await this.session.tap(x, y);
      return recovered ? { recovered: true } : {};
    }, { x, y });
  }

  async touchAndHold(x: number, y: number, durationMs: number): Promise<DeviceEnvelope> {
    return this.envelope("touchAndHold", false, async () => {
      const recovered = await this.session.touchAndHold(x, y, durationMs / 1000);
      return recovered ? { recovered: true } : {};
    }, { x, y, durationMs });
  }

  async swipe(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    durationMs = 500,
  ): Promise<DeviceEnvelope> {
    return this.envelope("swipe", false, async () => {
      const recovered = await this.session.drag(fromX, fromY, toX, toY, durationMs / 1000);
      return recovered ? { recovered: true } : {};
    }, { fromX, fromY, toX, toY, durationMs });
  }

  /** Type text. The text itself never enters evidence or the audit log. */
  async type(text: string): Promise<DeviceEnvelope> {
    return this.envelope("type", false, async () => {
      const recovered = await this.session.sendKeys(text);
      return recovered ? { recovered: true } : {};
    }, { length: text.length });
  }

  /**
   * tap_text via the tree. With no usable tree this fails degraded with
   * tree_unavailable instead of guessing pixels — pixel locating is the
   * caller's job (fallback.ts).
   */
  async tapText(label: string): Promise<DeviceEnvelope> {
    const startedAt = performance.now();
    const obs = await this.observe();
    const tree = obs.evidence["tree"] as UiTree | undefined;
    if (!obs.ok || tree == null) {
      return this.done("tap_text", false, true, {
        action: "tap_text",
        tree_unavailable: true,
        note: "tree unavailable; caller owns pixel locating",
      }, startedAt);
    }
    const node =
      tree.nodes.find((n) => n.label === label) ??
      tree.nodes.find((n) => n.name === label);
    if (!node) {
      return this.done("tap_text", false, true, {
        action: "tap_text",
        reason: "label_not_found",
        nodeCount: tree.nodes.length,
      }, startedAt);
    }
    return this.tap(node.x + node.width / 2, node.y + node.height / 2);
  }

  // -- screenshot / geometry ----------------------------------------------

  async screenshot(): Promise<DeviceEnvelope> {
    return this.envelope("screenshot", false, async () => {
      const { bytes, recovered } = await this.session.screenshotBytes();
      return {
        screenshot: bytes,
        bytes: bytes.length,
        ...(recovered ? { recovered: true } : {}),
      };
    });
  }

  async windowSize(): Promise<{ width: number; height: number }> {
    const { width, height } = await this.session.windowSize();
    return { width, height };
  }

  /**
   * Per-frame pixel mapping: reads a FRESH /window/size (the ios-agent
   * approach — never cache the ratio across frames), then converts the
   * caller's normalized box to WDA tap coordinates.
   */
  async mapScreenshotBox(
    screenshot: Buffer,
    box: NormalizedBox,
    orientation: ScreenshotOrientation = "portrait",
  ): Promise<{ x: number; y: number }> {
    const { width, height } = await this.windowSize();
    return screenshotToTapPoint(screenshot, box, {
      logicalWidth: width,
      logicalHeight: height,
      screenshotOrientation: orientation,
    });
  }

  lastTree(): UiTree | null {
    return this.lastUsableTree;
  }

  // -- envelope plumbing ---------------------------------------------------

  /**
   * Runs a mutating action exactly once. Transport ambiguity
   * (ActionTimeout / ConnectionLost) => ok:false + uncertain:true, never
   * replayed. SessionLost / connection-refused RunnerCrashed were
   * already healed+retried once inside the session (safe: the action
   * provably never executed) and surface as recovered:true.
   */
  private async envelope(
    action: string,
    degraded: boolean,
    fn: () => Promise<Record<string, unknown>>,
    attempted: Record<string, unknown> = {},
  ): Promise<DeviceEnvelope> {
    const startedAt = performance.now();
    const evidence: Record<string, unknown> = { action, attempted };
    try {
      const extra = await fn();
      Object.assign(evidence, extra);
      return this.done(action, true, degraded, evidence, startedAt);
    } catch (err) {
      if (err instanceof ActionTimeout || err instanceof ConnectionLost) {
        evidence["uncertain"] = true;
        evidence["reason"] = err.code;
        evidence["hint"] = err.hint;
        return this.done(action, false, degraded, evidence, startedAt);
      }
      if (err instanceof SessionLost || err instanceof RunnerCrashed) {
        // Auto-heal was disabled or the heal itself failed.
        evidence["uncertain"] = false;
        evidence["reason"] = err.code;
        evidence["hint"] = err.hint;
        return this.done(action, false, degraded, evidence, startedAt);
      }
      evidence["uncertain"] = false;
      evidence["reason"] = err instanceof Error ? err.message : String(err);
      return this.done(action, false, degraded, evidence, startedAt);
    }
  }

  private done(
    action: string,
    ok: boolean,
    degraded: boolean,
    evidence: Record<string, unknown>,
    startedAt: number,
  ): DeviceEnvelope {
    const env: DeviceEnvelope = {
      ok,
      backend: "device",
      latency_ms: Math.round(performance.now() - startedAt),
      degraded,
      evidence,
    };
    recordAudit(action, env);
    return env;
  }
}
