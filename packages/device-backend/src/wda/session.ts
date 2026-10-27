// MIT License — Copyright (c) 2026 Ehsan
// Adapted from ios_mcp/wda/session.py in emazaheri/ios-agent
// (MIT; full text in packages/device-backend/NOTICE.md,
// license status pending GC final ruling).
//
// phonehands modifications:
//  - Ported to TypeScript.
//  - Auto-heal scope NARROWED (deliberate divergence, the no-auto-replay rule):
//    upstream retries on read-timeouts too. We heal+retry ONLY when the
//    action provably never executed:
//      * SessionLost ("invalid session id") — the session is dead, the
//        action was rejected, not executed.
//      * RunnerCrashed via connection-refused — the runner never saw it.
//    ActionTimeout / ConnectionLost (ambiguous) are NOT healed or
//    retried; they propagate so the caller marks them uncertain.
//  - No DeviceLocked wake: out of MVP scope (needs /wda/unlock; the
//    locked error surfaces to the caller instead).
//  - Session bootstrap keeps the unbound-session ordering (no bundleId
//    in capabilities) and shouldTerminateApp:false, for the reasons
//    documented in open().

/**
 * WebDriverAgent session lifecycle, tuned settings, and auto-heal.
 *
 * Auto-heal matters more here than in a test harness: an agent driving
 * a phone for several minutes will outlive at least one runner crash,
 * and an agent that has to reason about infrastructure failures wastes
 * turns. A recovered call reports recovered=true rather than raising —
 * but ONLY when the failed action provably never executed.
 */

import { WdaTransport, type TransportOptions } from "./transport.ts";
import { AutomationError, RunnerCrashed, SessionLost, WdaError } from "./errors.ts";
import {
  DEFAULT_SNAPSHOT_TUNING,
  snapshotSettingsPayload,
  type SnapshotTuning,
} from "./settings.ts";

export interface SessionOptions {
  /** Snapshot tuning pushed on every new/recovered session. */
  snapshotTuning?: SnapshotTuning;
  /** Enable auto-heal (default true). */
  autoHeal?: boolean;
  /** Transport timeouts (request/connect). Defaults: 10s / 3s. */
  transport?: TransportOptions;
  /**
   * Restarts the WDA runner and returns its new base URL.
   * Injected by the caller: the runner process lifecycle is owned by
   * the topology layer (Phase 1: scripts/remote-topology), not here.
   */
  relaunch?: () => Promise<string>;
}

export class WdaSession {
  private transport: WdaTransport;
  private readonly options: Required<Omit<SessionOptions, "relaunch">> &
    Pick<SessionOptions, "relaunch">;
  private sessionId: string | null = null;
  private bundleId: string | null = null;
  recoveredCount = 0;

  constructor(baseUrl: string, options: SessionOptions = {}) {
    // baseUrl is validated loopback-only by DeviceBackend before this runs.
    this.transport = new WdaTransport(baseUrl, options.transport);
    this.options = {
      snapshotTuning: options.snapshotTuning ?? DEFAULT_SNAPSHOT_TUNING,
      autoHeal: options.autoHeal ?? true,
      transport: options.transport ?? {},
      relaunch: options.relaunch,
    };
  }

  get activeSessionId(): string | null {
    return this.sessionId;
  }

  get activeBundleId(): string | null {
    return this.bundleId;
  }

  // -- lifecycle ---------------------------------------------------------

  /**
   * Create a session, then launch the app into it.
   *
   * The app is launched AFTER the session exists rather than named in
   * the capabilities, and that ordering is the whole point. A bundleId
   * in the capabilities pins the session to that app for its entire
   * life: every later /source keeps returning that app's tree no matter
   * what is actually in front. Launching afterwards leaves the session
   * unbound, so /source follows whatever is in the foreground.
   */
  async open(bundleId?: string): Promise<string> {
    const capabilities = {
      alwaysMatch: {
        // Without this WDA terminates whatever app is running on session
        // teardown, which is hostile on someone's real phone.
        shouldTerminateApp: false,
        eventloopIdleDelaySec: 0,
      },
      firstMatch: [{}],
    };
    const value = (await this.transport.post("/session", {
      capabilities,
    })) as { sessionId?: string } | null;
    const sessionId = value?.sessionId;
    if (!sessionId) {
      throw new SessionLost("WebDriverAgent created no session id", {
        hint: "Restart the runner, then retry.",
      });
    }
    this.sessionId = sessionId;
    this.bundleId = null;
    await this.applySnapshotTuning();
    if (bundleId) await this.launchApp(bundleId);
    return sessionId;
  }

  /**
   * Push the snapshot tuning that keeps observation affordable.
   * Runs on every new or recovered session. Older runners reject
   * unknown keys wholesale; degraded but usable, so we continue.
   */
  async applySnapshotTuning(): Promise<void> {
    const sid = this.sessionId;
    if (!sid) return;
    try {
      await this.transport.post(
        `/session/${sid}/appium/settings`,
        snapshotSettingsPayload(this.options.snapshotTuning),
      );
    } catch (err) {
      if (err instanceof WdaError) return; // degraded but usable
      throw err;
    }
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.transport.delete(`/session/${this.sessionId}`);
    } catch (err) {
      if (err instanceof AutomationError) return; // a dead session needs no closing
      throw err;
    } finally {
      this.sessionId = null;
    }
  }

  async ensureOpen(bundleId?: string): Promise<string> {
    if (this.sessionId === null) {
      await this.open(bundleId ?? this.bundleId ?? undefined);
    }
    if (this.sessionId === null) throw new SessionLost("Could not open a WDA session");
    return this.sessionId;
  }

  // -- auto-heal ---------------------------------------------------------

  /**
   * Run a session-scoped call, healing ONCE from the failures we can fix.
   *
   * Heals + retries only when the action provably never executed:
   * SessionLost (rejected by a dead session) and RunnerCrashed via
   * connection-refused (runner never saw the request). ActionTimeout
   * and ConnectionLost propagate untouched — replaying them would
   * violate "never replay uncertain".
   */
  async call<T>(
    fn: (sessionId: string) => Promise<T>,
    opts: { bundleId?: string } = {},
  ): Promise<{ value: T; recovered: boolean }> {
    const sessionId = await this.ensureOpen(opts.bundleId);
    try {
      return { value: await fn(sessionId), recovered: false };
    } catch (err) {
      if (!this.options.autoHeal) throw err;
      if (err instanceof SessionLost || err instanceof RunnerCrashed) {
        await this.heal(err);
        this.recoveredCount += 1;
        const healedId = await this.ensureOpen(opts.bundleId);
        return { value: await fn(healedId), recovered: true };
      }
      throw err;
    }
  }

  /**
   * Rebuild the session, restarting the runner first if it died, then
   * restore the app that was in the foreground before the crash.
   */
  private async heal(err: AutomationError): Promise<void> {
    this.sessionId = null;
    if (err instanceof RunnerCrashed) {
      if (!this.options.relaunch) {
        throw new RunnerCrashed("WebDriverAgent died and no relaunch hook is configured", {
          hint: "Open the session through the device pool so the runner can be restarted.",
        });
      }
      const baseUrl = await this.options.relaunch();
      this.transport = new WdaTransport(baseUrl);
    }
    await this.open(this.bundleId ?? undefined);
  }

  // -- observation --------------------------------------------------------

  /** Raw accessibility-tree XML (GET /source). */
  async sourceXml(): Promise<{ xml: string; recovered: boolean }> {
    const { value, recovered } = await this.call((sid) =>
      this.transport.get(`/session/${sid}/source`),
    );
    if (typeof value !== "string") {
      throw new WdaError("GET /source returned a non-string value");
    }
    return { xml: value, recovered };
  }

  /** PNG screenshot bytes. */
  async screenshotBytes(): Promise<{ bytes: Buffer; recovered: boolean }> {
    const { value, recovered } = await this.call((sid) =>
      this.transport.screenshotPng(sid),
    );
    assertPng(value);
    return { bytes: value, recovered };
  }

  /** Logical screen size in points (GET /window/size). */
  async windowSize(): Promise<{ width: number; height: number; recovered: boolean }> {
    const { value, recovered } = await this.call((sid) =>
      this.transport.get(`/session/${sid}/window/size`),
    );
    const v = value as { width?: unknown; height?: unknown };
    if (
      typeof v !== "object" ||
      v === null ||
      typeof v.width !== "number" ||
      typeof v.height !== "number"
    ) {
      throw new WdaError("GET /window/size returned an unexpected value");
    }
    return { width: v.width, height: v.height, recovered };
  }

  // -- interaction --------------------------------------------------------

  async tap(x: number, y: number): Promise<boolean> {
    const { recovered } = await this.call((sid) =>
      this.transport.post(`/session/${sid}/wda/tap`, { x, y }),
    );
    return recovered;
  }

  async touchAndHold(x: number, y: number, durationS: number): Promise<boolean> {
    const { recovered } = await this.call((sid) =>
      this.transport.post(`/session/${sid}/wda/touchAndHold`, {
        x,
        y,
        duration: durationS,
      }),
    );
    return recovered;
  }

  async drag(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    durationS = 0.5,
  ): Promise<boolean> {
    const { recovered } = await this.call((sid) =>
      this.transport.post(`/session/${sid}/wda/dragfromtoforduration`, {
        fromX,
        fromY,
        toX,
        toY,
        duration: durationS,
      }),
    );
    return recovered;
  }

  /** Type into whatever currently holds keyboard focus (W3C /keys). */
  async sendKeys(text: string): Promise<boolean> {
    const { recovered } = await this.call((sid) =>
      this.transport.post(`/session/${sid}/keys`, { value: [text] }),
    );
    return recovered;
  }

  async pressButton(name: string): Promise<boolean> {
    const { recovered } = await this.call((sid) =>
      this.transport.post(`/session/${sid}/wda/pressButton`, { name }),
    );
    return recovered;
  }

  // -- app control --------------------------------------------------------

  async launchApp(bundleId: string, fresh = false): Promise<void> {
    const payload: Record<string, unknown> = {
      bundleId,
      shouldWaitForQuiescence: true,
    };
    if (fresh) payload["forceAppLaunch"] = true;
    await this.call((sid) => this.transport.post(`/session/${sid}/wda/apps/launch`, payload));
    this.bundleId = bundleId;
  }

  async activateApp(bundleId: string): Promise<void> {
    await this.call((sid) =>
      this.transport.post(`/session/${sid}/wda/apps/activate`, { bundleId }),
    );
    this.bundleId = bundleId;
  }

  async terminateApp(bundleId: string): Promise<boolean> {
    const { value } = await this.call((sid) =>
      this.transport.post(`/session/${sid}/wda/apps/terminate`, { bundleId }),
    );
    return Boolean(value);
  }
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function assertPng(bytes: Buffer): void {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new WdaError("Screenshot payload is not a PNG");
  }
}
