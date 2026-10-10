// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/**
 * emulator-smoke.ts — CI-only real-device smoke for gate 4a.
 *
 * Runs inside the android-emulator workflow AFTER the emulator boots.
 * Unlike the unit/e2e tests (which use MockAndroidDevice over real TCP),
 * this script drives a REAL Android OS through the EXACT adb command
 * shapes our wireless-adb fallback documents (tapCommand / screenshotCommand
 * builders) — proving the command contract against a real device.
 *
 * Env:
 *   ANDROID_SERIAL  adb serial of the target (workflow sets it from `adb get-serialno`)
 *
 * Exit 0 = tap executed + screencap returned a real PNG.
 * Honest scope: proves adb reachability + command shapes on a real Android
 * OS. The helper APK path (AccessibilityService/MediaProjection) still
 * needs gate 4b physical devices.
 */

import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  tapCommand,
  screenshotCommand,
  type AdbTarget,
} from "../../packages/android-backend/src/index.ts";

const execFileAsync = promisify(execFile);

const rawSerial = process.env.ANDROID_SERIAL?.trim();
if (!rawSerial) {
  console.error("[emulator-smoke] ANDROID_SERIAL not set — refusing to run.");
  process.exit(2);
}
const serial: string = rawSerial;
const target: AdbTarget = { serial };

async function run(cmd: string[]): Promise<{ stdout: Buffer; stderr: string }> {
  const [bin, ...args] = cmd;
  const { stdout, stderr } = await execFileAsync(bin!, args, {
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 60_000,
  });
  return { stdout: stdout as Buffer, stderr: String(stderr) };
}

async function main(): Promise<void> {
  console.log(`[emulator-smoke] target serial: ${serial}`);

  // 1. Liveness: device is really there.
  const { stdout: devicesOut } = await run(["adb", "devices", "-l"]);
  const devicesText = devicesOut.toString();
  assert.ok(
    devicesText.includes(serial) && devicesText.includes("device"),
    `serial ${serial} must be listed as a device`,
  );
  console.log("[emulator-smoke] adb devices: target present");

  // 2. Real tap through our command builder (lands on the emulator home screen;
  //    harmless on the disposable CI emulator).
  const tap = tapCommand(target, 540, 1200);
  console.log("[emulator-smoke] tap cmd:", tap.join(" "));
  await run(tap);
  console.log("[emulator-smoke] tap executed, no error");

  // 3. Real screencap through our command builder; assert PNG magic.
  const shot = screenshotCommand(target);
  console.log("[emulator-smoke] screencap cmd:", shot.join(" "));
  const { stdout: png } = await run(shot);
  assert.ok(png.length > 10_000, `screencap too small: ${png.length} bytes`);
  assert.deepEqual(
    [png[0], png[1], png[2], png[3]],
    [0x89, 0x50, 0x4e, 0x47],
    "screencap must be a real PNG",
  );
  console.log(`[emulator-smoke] screencap ok: ${png.length} bytes, PNG magic verified`);

  console.log("[emulator-smoke] ALL ASSERTIONS PASSED (real Android OS, real adb)");
}

main().catch((err) => {
  console.error("[emulator-smoke] FAILED:", err);
  process.exit(1);
});
