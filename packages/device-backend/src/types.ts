// SPDX-License-Identifier: BUSL-1.1

/**
 * Shared types for @phonehands/device-backend.
 *
 * The result envelope matches the core package contract:
 *   { ok, backend: "device", latency_ms, degraded, evidence }
 */

/** Envelope returned by every device-backend action. */
export interface DeviceEnvelope {
  ok: boolean;
  backend: "device";
  latency_ms: number;
  degraded: boolean;
  /** Machine-readable detail. On failure this carries the reason;
   *  on degrade it carries tree_unavailable: true; on uncertain
   *  mutating actions it carries uncertain: true. */
  evidence: Record<string, unknown>;
}

/** One node of the accessibility (UI) tree. */
export interface UiNode {
  type: string;
  name: string;
  label: string;
  value: string;
  enabled: boolean;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Nesting depth, 0 = application root. */
  depth: number;
}

/** Parsed accessibility tree. */
export interface UiTree {
  nodes: UiNode[];
  /** Raw XML as returned by GET /session/:id/source. */
  rawXml: string;
}

/** Result of observe(): tree-first, screenshot fallback. */
export interface ObserveData {
  tree: UiTree | null;
  screenshot: Buffer | null;
  /** True when the tree was empty/malformed/unreachable and the
   *  screenshot fallback was used. The caller (Router/pixel locator)
   *  owns pixel-level locating — the client never blind-retries. */
  treeUnavailable: boolean;
}

/** Tap target for tap_text(). */
export interface TapTarget {
  x: number;
  y: number;
}

/** Options for WdaClient construction. */
export interface WdaClientOptions {
  /** e.g. "http://127.0.0.1:8100". Loopback-only: any non-loopback
   *  host throws DeviceSecurityError at construction. */
  baseUrl: string;
  /** Per-request socket timeout in ms. Default 10_000. */
  requestTimeoutMs?: number;
}
