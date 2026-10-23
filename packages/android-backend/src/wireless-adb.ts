// SPDX-License-Identifier: BUSL-1.1

/**
 * Wireless ADB fallback hook (documented, not wired by default).
 *
 * When the helper APK cannot be installed (or its screen stream is down),
 * the fallback path is wireless ADB: `adb tcpip 5555` on the phone, then
 * `adb connect <phone-ip>:5555` from the agent side, then plain shell input:
 *
 *   adb -s <id> shell input tap <x> <y>
 *   adb -s <id> shell input swipe <x1> <y1> <x2> <y2> <ms>
 *   adb -s <id> exec-out screencap -p            (PNG to stdout)
 *   adb -s <id> shell monkey -p <pkg> -c android.intent.category.LAUNCHER 1
 *
 * This class is a thin, dependency-free wrapper that builds the exact
 * commands. The caller runs them (execFile) and handles failures. It is a
 * HOOK — the primary path is always the WebSocket helper APK. Nothing here
 * runs automatically.
 *
 * No root required. Shizuku (optional, see docs/android-deploy.md) can
 * replace `adb shell` with in-device privileged calls, but the APK already
 * covers those paths — Shizuku is documented as an enhancement, not a
 * requirement.
 */

import type { AndroidEnvelope } from "./types.ts";

export interface AdbTarget {
  /** e.g. "192.168.1.42:5555" after `adb connect`. */
  serial: string;
}

export function tapCommand(t: AdbTarget, x: number, y: number): string[] {
  return ["adb", "-s", t.serial, "shell", "input", "tap", String(x), String(y)];
}

export function swipeCommand(
  t: AdbTarget,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs: number,
): string[] {
  return [
    "adb", "-s", t.serial, "shell", "input", "swipe",
    String(x1), String(y1), String(x2), String(y2), String(durationMs),
  ];
}

export function screenshotCommand(t: AdbTarget): string[] {
  return ["adb", "-s", t.serial, "exec-out", "screencap", "-p"];
}

export function launchCommand(t: AdbTarget, packageName: string): string[] {
  return [
    "adb", "-s", t.serial, "shell", "monkey",
    "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1",
  ];
}

/** Shape an adb failure into the standard envelope (for callers). */
export function adbFailure(
  action: string,
  detail: string,
): AndroidEnvelope {
  return {
    ok: false,
    backend: "device",
    devicePlatform: "android",
    latency_ms: -1,
    degraded: true,
    evidence: { action, reason: detail, fallback: "wireless-adb" },
  };
}

/**
 * Pairing instructions (human steps, kept here so the hook is self-describing):
 *  1. Phone and agent host on the same network (or phone via Tailscale IP).
 *  2. On the phone: enable Developer options > Wireless debugging, "Pair with
 *     pairing code", then `adb pair <ip>:<pair-port>` and enter the code.
 *  3. `adb connect <ip>:5555` (port shown under Wireless debugging).
 *  4. Commands above now work. Same-LAN only unless routed over Tailscale.
 */
export const WIRELESS_ADB_PAIRING_NOTE =
  "wireless adb is same-network (or Tailscale); it is the documented " +
  "fallback when the helper APK path is unavailable";
