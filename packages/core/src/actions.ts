// SPDX-License-Identifier: BUSL-1.1
// Unified Action interface — the frozen contract every package implements.
//
// Names and parameters are frozen: observe / tap / tap_text / swipe / type_text /
// read / launch_app / press_home / screenshot. Other packages MUST NOT change
// these signatures; capability differences are expressed through the backend's
// `capabilities` table, never through signature drift.
//
// Note on async: the brief shows sync shapes (observe(): { tree, screenshot }).
// All actions are async in practice (network / USB I/O), so every method
// returns a Promise of the documented shape. Names, params, and the result
// envelope are unchanged.

/** Swipe directions supported by the device engine. */
export type SwipeDirection = "up" | "down" | "left" | "right";

/** What `observe()` returns: the accessibility tree plus a screenshot. */
export interface ObserveResult {
  tree: unknown;
  screenshot: Uint8Array;
}

export interface PhoneAction {
  /** Look: accessibility tree + screenshot. */
  observe(): Promise<ObserveResult>;
  /** Tap at absolute screen coordinates. */
  tap(x: number, y: number): Promise<void>;
  /** Tap the control whose visible label matches. */
  tap_text(label: string): Promise<void>;
  /** Swipe in a direction. */
  swipe(dir: SwipeDirection): Promise<void>;
  /** Type text into the focused field. */
  type_text(text: string): Promise<void>;
  /** Structured read (API backend: JSON; device backend: tree/OCR extraction). */
  read(): Promise<unknown>;
  /** Launch an app by id/bundle id. */
  launch_app(id: string): Promise<void>;
  /** Press the home button / go home. */
  press_home(): Promise<void>;
  /** Raw screenshot bytes. */
  screenshot(): Promise<Uint8Array>;
}

/** Every action name, derived from the interface so the two cannot drift. */
export type ActionName = keyof PhoneAction;

export const ALL_ACTION_NAMES: readonly ActionName[] = [
  "observe",
  "tap",
  "tap_text",
  "swipe",
  "type_text",
  "read",
  "launch_app",
  "press_home",
  "screenshot",
];

/**
 * Write actions gated by the compile-time read-only switch.
 * When built with PHONEHANDS_READ_ONLY=1 these are NOT registered —
 * not registered-and-blocked, but absent from the code (hinge-mcp P3).
 */
export const WRITE_ACTION_NAMES: readonly ActionName[] = [
  "tap",
  "tap_text",
  "swipe",
  "type_text",
  "launch_app",
  "press_home",
];

/** Privilege tier per action. The Router NEVER moves a request to a
 *  higher-privilege backend silently (T5 no-silent-escalation rule). */
export type PrivilegeTier = "read" | "write";

export const ACTION_PRIVILEGE: Record<ActionName, PrivilegeTier> = {
  observe: "read",
  read: "read",
  screenshot: "read",
  tap: "write",
  tap_text: "write",
  swipe: "write",
  type_text: "write",
  launch_app: "write",
  press_home: "write",
};
