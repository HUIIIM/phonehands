// SPDX-License-Identifier: BUSL-1.1
// Backend contract: every engine (api, device-ios, device-android, ...) is a
// Backend that declares WHAT it can do via `capabilities`. The Router routes
// by table lookup, never by hardcoded if-else chains (立项书 §2.4 诚实边界).

import { ALL_ACTION_NAMES } from "./actions.ts";
import type { ActionName } from "./actions.ts";
import type { ActionResult, BackendKind, DevicePlatform } from "./types.ts";

export interface Backend {
  /** Human-readable backend name, e.g. "hinge-api", "wda-ios", "android-adb". */
  readonly name: string;
  readonly kind: BackendKind;
  /**
   * Platform for device backends ("ios" | "android"). Required when
   * kind === "device" — enforced at registration. Third backends (e.g. an
   * Android backend) register their own capabilities; the Router needs no
   * code change to pick them up.
   */
  readonly devicePlatform?: DevicePlatform;
  /** Capability declaration: which actions this backend can perform. */
  readonly capabilities: Record<ActionName, boolean>;
  /** Execute one action. Must return a full ActionResult envelope. */
  invoke(action: ActionName, args: Record<string, unknown>): Promise<ActionResult>;
  /** Health probe used by the Router's degrade/recover logic. */
  checkHealth(): Promise<boolean>;
}

/** Build a capabilities table: listed actions true, everything else false. */
export function capabilitiesFor(...names: ActionName[]): Record<ActionName, boolean> {
  const table = {} as Record<ActionName, boolean>;
  for (const name of ALL_ACTION_NAMES) {
    table[name] = names.includes(name);
  }
  return table;
}
