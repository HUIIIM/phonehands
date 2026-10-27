#!/usr/bin/env bash
# SPDX-License-Identifier: BUSL-1.1
# Runs inside reactivecircus/android-emulator-runner once the emulator has
# booted. Kept as one script because the action runs each line of `script:`
# in its own `sh -c` (no shared variables, no `set -e`, no `\` continuations).
set -euo pipefail

adb wait-for-device
SERIAL="$(adb get-serialno)"
echo "Emulator serial: ${SERIAL}"

echo "--- 1/3 android-backend suite (real TCP/WS, mock phone) ---"
npm test --workspace=@phonehands/android-backend

echo "--- 2/3 wireless-demo assertions ---"
PHONEHANDS_RELAY_URL="ws://127.0.0.1:8099/phonehands-android" \
  node examples/android-wireless-demo/demo.ts

echo "--- 3/3 real adb smoke (real Android OS, our cmd builders) ---"
ANDROID_SERIAL="${SERIAL}" node examples/android-wireless-demo/emulator-smoke.ts
