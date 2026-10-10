// MIT License — Copyright (c) 2026 Ehsan
// Adapted from ios_mcp/config.py (SnapshotSettings) and
// ios_mcp/wda/session.py (_SETTINGS_KEYS / apply_settings) in
// emazaheri/ios-agent (MIT; full text in
// packages/device-backend/NOTICE.md, license status pending GC final
// ruling).
//
// phonehands modifications:
//  - Ported to TypeScript; tuning values unchanged (they were measured
//    on a physical iPhone: depth 20 silently loses a third of the
//    screen's elements; past 30 is free because the round trip, not the
//    traversal, dominates).
//  - The tuning is pushed on every new AND every recovered session,
//    because a healed session otherwise falls back to WDA's expensive
//    defaults.

/**
 * WDA session settings that govern accessibility snapshot cost.
 *
 * WDA's defaults produce trees far too large and slow for an agent
 * loop, so this tuning is pushed via POST /appium/settings on every
 * new or recovered session. Measured on iOS 26.6 Settings, physical
 * iPhone, raw tree nodes by depth: 20 -> 336, 30 -> 421, 40/50/60 ->
 * 421. Depth 20 silently loses a third of the screen's elements, and
 * everything past 30 is free: wall time stayed within 3.5-3.9s at
 * every depth because the round trip dominates, not the traversal.
 */
export interface SnapshotTuning {
  /** Max tree depth. Default 50: headroom for deep hierarchies, free. */
  maxDepth: number;
  /** Max children per node before truncation. Default 64. */
  maxChildren: number;
  /** Seconds WDA may spend building a snapshot. Default 5.0. */
  customSnapshotTimeoutS: number;
  /** Seconds WDA waits for the app to idle. Default 2.0. */
  waitForIdleTimeoutS: number;
  /** Stop at the first matching element. Default true. */
  useFirstMatch: boolean;
}

export const DEFAULT_SNAPSHOT_TUNING: SnapshotTuning = {
  maxDepth: 50,
  maxChildren: 64,
  customSnapshotTimeoutS: 5.0,
  waitForIdleTimeoutS: 2.0,
  useFirstMatch: true,
};

/** WDA setting key -> our field name. */
const SETTINGS_KEYS: Array<[wdaKey: string, field: keyof SnapshotTuning]> = [
  ["snapshotMaxDepth", "maxDepth"],
  ["snapshotMaxChildren", "maxChildren"],
  ["customSnapshotTimeout", "customSnapshotTimeoutS"],
  ["waitForIdleTimeout", "waitForIdleTimeoutS"],
  ["useFirstMatch", "useFirstMatch"],
];

/** Builds the POST /appium/settings payload from a tuning. */
export function snapshotSettingsPayload(
  tuning: SnapshotTuning = DEFAULT_SNAPSHOT_TUNING,
): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  for (const [wdaKey, field] of SETTINGS_KEYS) {
    settings[wdaKey] = tuning[field];
  }
  return { settings };
}
