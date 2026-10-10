// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)
// Router: capability-table routing across the two engines.
//
// Default policy: read-tier actions (observe/read/screenshot) → API engine;
// write-tier actions (tap/tap_text/swipe/type_text/launch_app/press_home) →
// device engine. The Router looks up (action, deviceType) in each backend's
// `capabilities` table — there are no hardcoded per-app/per-backend if-else
// chains (立项书 §2.4 诚实边界: 路由策略会长成一堆规则 → 用能力声明).
//
// Health: the API backend is probed on 4xx/timeout. 3 consecutive faults →
// degraded: ALL traffic goes to the device engine and envelopes carry
// degraded:true. 5 consecutive successful probes → automatic recovery.
// AUTH_REQUIRED is NOT an engine fault (a human takes over) and never
// counts toward degradation.
//
// No silent escalation (T5): the Router NEVER moves a request to a
// higher-privilege backend on its own. If the policy backend cannot serve
// an action, dispatch fails with NO_CAPABLE_BACKEND — unless the caller
// explicitly passes allowEscalation:true, in which case the envelope is
// marked escalated:true. Escalation comes from explicit capability
// declaration + caller intent, and the envelope tells the truth about it.
//
// ── Security modes (DESIGN, Phase 2 implementation — STUB(P2-8)) ──────────
// Normal (default): policy routing + auto-degrade + no silent escalation,
//   as implemented here.
// Yellow (elevated caution): all write-tier actions require an explicit
//   per-dispatch confirm flag; deadlines tighten; audit verbosity rises.
//   Entered by host policy (e.g. new device, flaky network), exited by host.
// Red (lockdown): MUST be entered explicitly — the Router refuses every new
//   dispatch except the emergencyStop path; in-flight ops run to their
//   deadline and then the fleet halts. There is no automatic entry into Red.
// Phase 2 wires the mode state machine (enter/exit API + per-mode policy
// overrides). This file only reserves the vocabulary.

import { ACTION_PRIVILEGE } from "./actions.ts";
import type { ActionName } from "./actions.ts";
import type { Backend } from "./backend.ts";
import { AuthHandoff } from "./auth-handoff.ts";
import {
  ActionNotRegisteredError,
  DeviceTypeRequiredError,
  EmergencyStoppedError,
  NoCapableBackendError,
  ResultValidationError,
} from "./errors.ts";
import { ActionRegistry } from "./registry.ts";
import { AUTH_REQUIRED, validateResult } from "./types.ts";
import type { ActionError, ActionResult, BackendKind, DevicePlatform } from "./types.ts";

export interface DispatchOptions {
  /** Required when the policy backend is "device" ("ios" → WDA, "android" → android backend). */
  deviceType?: DevicePlatform;
  /**
   * Allow the Router to substitute a backend of a different kind when the
   * policy backend cannot serve the action. The envelope is then marked
   * escalated:true. Default false → fail loudly with NO_CAPABLE_BACKEND.
   */
  allowEscalation?: boolean;
}

export interface RouterOptions {
  registry: ActionRegistry;
  authHandoff?: AuthHandoff;
  /** Consecutive API 4xx/timeout faults before degrade (default 3). */
  degradeAfterFaults?: number;
  /** Consecutive successful probes before recovery (default 5). */
  recoverAfterProbes?: number;
}

function isApiFault(error: ActionError | undefined): boolean {
  if (!error) return false;
  return error.code === "TIMEOUT" || /^HTTP_4\d\d$/.test(error.code) || error.code === "ECONNRESET";
}

function faultResult(backend: Backend, err: unknown, devicePlatform?: DevicePlatform): ActionResult {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof Error && "code" in err && typeof (err as { code: unknown }).code === "string"
    ? ((err as { code: string }).code as string)
    : "BACKEND_THROW";
  return {
    ok: false,
    backend: backend.kind,
    latency_ms: 0,
    degraded: false,
    escalated: false,
    evidence: null,
    ...(devicePlatform ? { devicePlatform } : {}),
    error: { code, message },
  };
}

export class Router {
  private readonly registry: ActionRegistry;
  private readonly authHandoff?: AuthHandoff;
  private readonly degradeAfterFaults: number;
  private readonly recoverAfterProbes: number;
  private apiFaults = 0;
  private recoverStreak = 0;
  private apiDegraded = false;
  private stopped = false;

  constructor(options: RouterOptions) {
    this.registry = options.registry;
    this.authHandoff = options.authHandoff;
    this.degradeAfterFaults = options.degradeAfterFaults ?? 3;
    this.recoverAfterProbes = options.recoverAfterProbes ?? 5;
  }

  /** True while the API engine is marked degraded. */
  get degraded(): boolean {
    return this.apiDegraded;
  }

  /**
   * Emergency stop — STUB(P2-4): engages the stop flag so no NEW dispatch
   * is accepted; in-flight ops run to their queue deadline. Phase 2 wires
   * this to tearing down the agent run + tool processes (see
   * docs/phase2-backlog.md P2-4). Reserved here so hosts can already depend
   * on the interface.
   */
  emergencyStop(): void {
    this.stopped = true;
  }

  /** Release the emergency stop (host-explicit only). */
  clearEmergencyStop(): void {
    this.stopped = false;
  }

  /**
   * Probe the API engine while degraded. 5 consecutive successes flip the
   * Router back to the API engine automatically. Safe to call anytime.
   */
  async probeApi(): Promise<boolean> {
    const api = this.registry.getBackends().find((b) => b.kind === "api");
    if (!api) return false;
    let healthy = false;
    try {
      healthy = await api.checkHealth();
    } catch {
      healthy = false;
    }
    if (healthy) {
      this.recoverStreak += 1;
      if (this.apiDegraded && this.recoverStreak >= this.recoverAfterProbes) {
        this.apiDegraded = false;
        this.apiFaults = 0;
        this.recoverStreak = 0;
      }
    } else {
      this.recoverStreak = 0;
    }
    return healthy;
  }

  async dispatch(
    accountId: string,
    action: ActionName,
    args: Record<string, unknown> = {},
    options: DispatchOptions = {}
  ): Promise<ActionResult> {
    if (this.stopped) {
      throw new EmergencyStoppedError();
    }
    if (!this.registry.hasAction(action)) {
      // In a read-only build this is how a write action fails:
      // it was never registered, so there is nothing to intercept.
      throw new ActionNotRegisteredError(action);
    }

    // Policy: read tier → api, write tier → device. Table lookup, no if-else
    // per backend.
    let kind: BackendKind = ACTION_PRIVILEGE[action] === "read" ? "api" : "device";
    let degraded = false;
    if (kind === "api" && this.apiDegraded) {
      kind = "device"; // declared fallback, always marked degraded:true
      degraded = true;
    }

    let backend = this.pickBackend(kind, action, options.deviceType);
    let escalated = false;
    if (!backend) {
      if (options.allowEscalation === true) {
        backend = this.pickAnyCapable(action, options.deviceType);
        escalated = backend !== undefined;
      }
      if (!backend) {
        throw new NoCapableBackendError(action, kind, options.deviceType);
      }
    }

    const started = Date.now();
    let raw: ActionResult;
    try {
      raw = await backend.invoke(action, args);
    } catch (err) {
      raw = faultResult(backend, err, backend.devicePlatform);
    }

    const safeRaw: Partial<ActionResult> = raw ?? {};
    const result: ActionResult = {
      evidence: null,
      ...safeRaw,
      ok: safeRaw.ok === true, // normalize: a backend that returns nothing/undefined is a failure
      backend: backend.kind,
      latency_ms: Date.now() - started,
      degraded: degraded || safeRaw.degraded === true,
      escalated,
    };
    if (backend.kind === "device" && backend.devicePlatform) {
      result.devicePlatform = result.devicePlatform ?? backend.devicePlatform;
    }
    // Contract: devicePlatform is mandatory iff backend is "device".
    try {
      validateResult(result);
    } catch (err) {
      if (err instanceof ResultValidationError) throw err;
      throw new ResultValidationError(`invalid envelope from backend "${backend.name}"`);
    }

    // Auth wall: human takes over. Not an engine fault — no degrade count,
    // no retry; the handoff pauses this account's queue.
    if (!result.ok && result.error?.code === AUTH_REQUIRED) {
      this.authHandoff?.raise(accountId, result.error.wallType ?? "unknown");
      return result;
    }

    // Health accounting: only API 4xx/timeout faults count toward degrade.
    if (backend.kind === "api") {
      if (!result.ok && isApiFault(result.error)) {
        this.apiFaults += 1;
        if (this.apiFaults >= this.degradeAfterFaults) {
          this.apiDegraded = true;
          this.recoverStreak = 0;
        }
      } else if (result.ok) {
        this.apiFaults = 0;
      }
    }
    return result;
  }

  private pickBackend(
    kind: BackendKind,
    action: ActionName,
    deviceType?: DevicePlatform
  ): Backend | undefined {
    if (kind === "device" && !deviceType) {
      throw new DeviceTypeRequiredError(action);
    }
    return this.registry
      .getBackends()
      .find((b) => b.kind === kind && b.capabilities[action] === true && (kind !== "device" || b.devicePlatform === deviceType));
  }

  private pickAnyCapable(action: ActionName, deviceType?: DevicePlatform): Backend | undefined {
    return this.registry
      .getBackends()
      .find(
        (b) =>
          b.capabilities[action] === true &&
          (b.kind !== "device" || !deviceType || b.devicePlatform === deviceType)
      );
  }
}
