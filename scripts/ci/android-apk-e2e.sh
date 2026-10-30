#!/usr/bin/env bash
# SPDX-License-Identifier: BUSL-1.1
# Real-APK end-to-end on the booted emulator: install the helper, grant the
# accessibility service, start the agent service through its own UI, and let
# examples/android-wireless-demo/apk-e2e.ts drive it over the real relay.
set -euo pipefail

APK="${1:-packages/android-helper/app/build/outputs/apk/debug/app-debug.apk}"
PKG=com.phonehands.helper
A11Y="${PKG}/${PKG}.TouchService"
LOG_DIR="${RUNNER_TEMP:-/tmp}/apk-e2e"
mkdir -p "$LOG_DIR"

adb wait-for-device
adb install -r -g "$APK"

# Accessibility can't be granted from the app itself; on an emulator the shell can.
adb shell settings put secure enabled_accessibility_services "$A11Y"
adb shell settings put secure accessibility_enabled 1

# The APK's default relay is ws://127.0.0.1:9011 — map the phone's loopback to ours.
adb reverse tcp:9011 tcp:9011

adb logcat -c
adb logcat -v time > "$LOG_DIR/logcat.txt" 2>&1 &
LOGCAT_PID=$!

node examples/android-wireless-demo/apk-e2e.ts > "$LOG_DIR/relay.txt" 2>&1 &
RELAY_PID=$!
cleanup() { kill "$LOGCAT_PID" 2>/dev/null || true; kill "$RELAY_PID" 2>/dev/null || true; }
trap cleanup EXIT
sleep 2

# Start the agent service the way a user does: tap "Start agent service".
adb shell am start -W -n "$PKG/.MainActivity"
tapped=0
for _ in $(seq 1 10); do
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
  adb pull /sdcard/ui.xml "$LOG_DIR/ui.xml" >/dev/null 2>&1 || true
  xy="$(python3 - "$LOG_DIR/ui.xml" <<'PY' || true
import re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="replace").read()
m = re.search(r'text="Start agent service"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml)
if m:
    x1, y1, x2, y2 = map(int, m.groups())
    print((x1 + x2) // 2, (y1 + y2) // 2)
PY
)"
  if [ -n "$xy" ]; then
    # shellcheck disable=SC2086
    adb shell input tap $xy
    tapped=1
    break
  fi
  sleep 2
done
[ "$tapped" = 1 ] || { echo "::error::could not find the 'Start agent service' button"; cat "$LOG_DIR/ui.xml" || true; exit 1; }

status=0
wait "$RELAY_PID" || status=$?
cat "$LOG_DIR/relay.txt"
if [ "$status" != 0 ]; then
  echo "::error::apk-e2e failed (exit $status); helper logcat follows"
  grep -iE "phonehands|AndroidRuntime|FATAL" "$LOG_DIR/logcat.txt" | tail -80 || true
fi
exit "$status"
