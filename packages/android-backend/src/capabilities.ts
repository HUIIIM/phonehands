// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/**
 * Capability declaration for the Android device backend.
 *
 * The core Router does table lookup instead of hardcoded if-else: it asks
 * each backend what it can do and routes accordingly.
 *
 * MVP (wireless-first): tap / swipe / screenshot / launch / observe.
 * Phase 2: type (text input) — the wire format reserves the action name,
 * the phone APK already exposes the AccessibilityService hooks for it.
 *
 * NOTE: unlike device-backend (iOS/WDA), there is deliberately no
 * tap_text here — text locating arrives with Phase 2's type work.
 */

export const ANDROID_CAPABILITIES = [
  "tap",
  "swipe",
  "screenshot",
  "launch",
  "observe",
] as const;

export type AndroidCapability = (typeof ANDROID_CAPABILITIES)[number];

export const CORE_ACTION_TO_ANDROID: Record<string, AndroidCapability | null> = {
  tap: "tap",
  swipe: "swipe",
  screenshot: "screenshot",
  observe: "observe",
  launch_app: "launch",
  // Phase 2 (not wired yet — fail closed, Router must use another backend):
  tap_text: null,
  type: null,
  type_text: null,
  press_home: null,
  read: null,
};

/** True when this backend can serve the given core action name. */
export function canHandle(coreAction: string): boolean {
  return CORE_ACTION_TO_ANDROID[coreAction] != null;
}

/** The Android capability backing a core action, or null. */
export function capabilityFor(coreAction: string): AndroidCapability | null {
  return CORE_ACTION_TO_ANDROID[coreAction] ?? null;
}

/** devicePlatform discriminator the Router uses to pick the engine. */
export const DEVICE_PLATFORM = "android" as const;
