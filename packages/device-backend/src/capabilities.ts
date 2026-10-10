// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/**
 * Capability declaration for the device backend.
 *
 * The core Router does table lookup instead of hardcoded if-else:
 * it asks each backend what it can do and routes accordingly.
 * device-backend declares: tap / swipe / type / observe / screenshot.
 */

export const DEVICE_CAPABILITIES = [
  "tap",
  "swipe",
  "type",
  "observe",
  "screenshot",
] as const;

export type DeviceCapability = (typeof DEVICE_CAPABILITIES)[number];

/**
 * Maps core Action names to device-backend capabilities.
 * null = not supported by the device backend (Router must use another
 * backend or report unsupported).
 *
 * Notes:
 *  - tap_text / type_text are core-level conveniences; on device they
 *    are implemented via observe+tap / focus+keys.
 *  - read on device degrades to observe (tree -> screenshot fallback);
 *    structured extraction is the caller's job.
 */
export const CORE_ACTION_TO_DEVICE: Record<string, DeviceCapability | null> = {
  tap: "tap",
  tap_text: "tap",
  swipe: "swipe",
  type: "type",
  type_text: "type",
  observe: "observe",
  screenshot: "screenshot",
  read: "observe",
  launch_app: null,
  press_home: null,
};

/** True when this backend can serve the given core action name. */
export function canHandle(coreAction: string): boolean {
  return CORE_ACTION_TO_DEVICE[coreAction] != null;
}

/** The device capability backing a core action, or null. */
export function capabilityFor(coreAction: string): DeviceCapability | null {
  return CORE_ACTION_TO_DEVICE[coreAction] ?? null;
}
