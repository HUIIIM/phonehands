#!/usr/bin/env bash
# SPDX-License-Identifier: BUSL-1.1 (pending GC final review)
#
# resign.sh — WDA signature watchdog + one-click re-sign (macOS).
#
# A free Apple ID signature lasts 7 days. This script:
#   1. reads the expiry from the provisioning profile embedded in the signed
#      WebDriverAgentRunner.app on disk (the ground truth — no separate state
#      file that can lie after a failed re-sign);
#   2. prints remaining time; at <= 48h prints WARN + the re-sign command;
#   3. --resign runs the automatable part: `xcodebuild test` rebuilds,
#      re-signs with YOUR already-selected team, reinstalls and launches WDA.
#      The phone MUST be unlocked by your hand first — iOS refuses installs
#      on a locked phone and no script can change that. This script never
#      asks for your Apple ID or password.
#
# Honest clock note: Apple pins every re-sign to the App ID's original 7-day
# window — re-signing mid-week does NOT extend the clock. The countdown
# resets only with the first sign AFTER expiry. So: we warn at 48h, but the
# effective re-sign lands at/after expiry; the command is the same either way.
#
# Paid Apple Developer Program ($99/yr) path: do the Xcode signing step once
# with your paid team selected (see DEPLOY.md); resign.sh then keeps working
# unchanged, and the horizon becomes ~1 year instead of 7 days. The script
# detects the team type from the profile and adjusts its report.
#
# Usage: resign.sh [--check] [--resign] [--force] [--yes]
#                  [--wda-dir PATH] [--wda-port PORT] [--timeout SEC]
# Exit: 0 = signature healthy (or re-sign succeeded)
#       1 = attention needed (<=48h / expired, no --resign given)
#       2 = re-sign attempted and failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

VERSION="0.1.0"
WARN_HOURS=48
TIMEOUT=300
WDA_PORT="${PHONEHANDS_WDA_PORT:-8100}"
WDA_DIR="${PHONEHANDS_WDA_DIR:-$HOME/.phonehands/WebDriverAgent}"
CHECK_ONLY=1; FORCE=0; YES=0

usage() {
  echo "resign.sh v$VERSION — WDA signature watchdog + one-click re-sign"
  awk 'NR>1 && /^set -euo pipefail$/ {exit} NR>1 {sub(/^# ?/, ""); print}' "$0"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --check)     CHECK_ONLY=1; shift ;;
    --resign)    CHECK_ONLY=0; shift ;;
    --force)     FORCE=1; shift ;;
    --yes)       YES=1; shift ;;
    --wda-dir)   WDA_DIR="$2"; shift 2 ;;
    --wda-port)  WDA_PORT="$2"; shift 2 ;;
    --timeout)   TIMEOUT="$2"; shift 2 ;;
    --help|-h)   usage; exit 0 ;;
    *)           die "unknown argument: $1 (try --help)" ;;
  esac
done

if [ "$(uname -s)" != "Darwin" ]; then
  log_info "resign.sh is macOS-only (WDA signing needs Xcode). Nothing to check here."
  exit 0
fi
ensure_dir

# ------------------------------------------------------------ read ground truth
APP="$(wda_app_path)"
[ -n "$APP" ] || die "no signed WebDriverAgentRunner.app found — run setup.sh first (it walks you through signing)."
PROV="$APP/embedded.mobileprovision"
[ -f "$PROV" ] || die "signed app found but no embedded.mobileprovision — re-run Xcode Product -> Test."

EXP_ISO="$(wda_profile_expiry_iso)"
REMAIN="$(wda_signing_hours_remaining "$EXP_ISO")"
TEAM_ID="$(security cms -D -i "$PROV" 2>/dev/null | plutil -extract TeamIdentifier.0 raw - 2>/dev/null || echo unknown)"
# Heuristic: free personal-team profiles live ~7 days; paid ~1 year.
if [ "$REMAIN" != "unknown" ] && [ "$REMAIN" != "expired" ] && [ "$REMAIN" -gt 720 ] 2>/dev/null; then
  TEAM_KIND="paid-style (~1y horizon)"
else
  TEAM_KIND="free personal team (7-day horizon)"
fi

echo "WDA signature: team $TEAM_ID [$TEAM_KIND]"
echo "  expires: ${EXP_ISO:-unknown}"
case "$REMAIN" in
  unknown) log_warn "could not compute remaining time — check manually in Xcode." ;;
  expired) log_error "EXPIRED — WDA will not launch until re-signed." ;;
  *)       if [ "$REMAIN" -le "$WARN_HOURS" ]; then
             log_warn "only ${REMAIN}h left (<= ${WARN_HOURS}h warning window)."
           else
             log_ok "${REMAIN}h remaining — healthy."
           fi ;;
esac

NEEDS_RESIGN=0
case "$REMAIN" in
  expired) NEEDS_RESIGN=1 ;;
  unknown) NEEDS_RESIGN=0 ;;
  *) [ "$REMAIN" -le "$WARN_HOURS" ] && NEEDS_RESIGN=1 ;;
esac

if [ "$CHECK_ONLY" = "1" ]; then
  if [ "$NEEDS_RESIGN" = "1" ]; then
    echo
    echo "Re-sign command (run when the phone is unlocked and in your hand):"
    echo "  $SCRIPT_DIR/resign.sh --resign"
    echo "Note: re-signing before expiry does not move Apple's 7-day clock —"
    echo "the countdown resets with the first sign AFTER expiry. Re-signing at"
    echo "expiry is the effective one; the command is identical."
    exit 1
  fi
  exit 0
fi

# ------------------------------------------------------------ --resign
if [ "$NEEDS_RESIGN" = "0" ] && [ "$FORCE" = "0" ]; then
  log_ok "signature still healthy (> ${WARN_HOURS}h) — nothing to do. Use --force to re-sign anyway."
  exit 0
fi

cat <<EOF

  +------------------------------------------------------------------+
  |  Re-sign needs your hand for ONE thing:                           |
  |  UNLOCK the iPhone and keep it unlocked (iOS refuses installs     |
  |  on a locked phone). Everything else below is automated.          |
  |  This script will NOT ask for your Apple ID or password —         |
  |  signing reuses the team you already selected in Xcode.           |
  +------------------------------------------------------------------+

EOF
if [ "$YES" = "0" ]; then
  printf 'Phone unlocked? Press ENTER to start the re-sign (Ctrl-C to abort)... '
  read -r _
else
  log_warn "--yes: proceeding without confirmation — make sure the phone is unlocked."
fi

command -v xcodebuild >/dev/null 2>&1 || die "xcodebuild not found — full Xcode required."
[ -f "$WDA_DIR/WebDriverAgent.xcodeproj/project.pbxproj" ] || die "WDA source not found at $WDA_DIR — run setup.sh first."
UDID="$(idevice_id -l 2>/dev/null | head -n 1 || true)"
[ -n "$UDID" ] || die "no iPhone on USB — plug it in, unlock, tap Trust, re-run."

# make sure we can verify the result
if ! wda_status_ok "127.0.0.1:$WDA_PORT"; then
  command -v iproxy >/dev/null 2>&1 || die "iproxy missing (brew install libimobiledevice)."
  start_bg "iproxy" iproxy "$WDA_PORT" 8100 "$UDID"
fi

LOG="$PHONEHANDS_DIR/resign.log"
log_info "running: xcodebuild -project <WDA> -scheme WebDriverAgentRunner -destination id=$UDID test"
log_info "(log: $LOG — Apple ID / password never appear here; xcodebuild reuses your Xcode team)"
xcodebuild -project "$WDA_DIR/WebDriverAgent.xcodeproj" \
  -scheme WebDriverAgentRunner \
  -destination "id=$UDID" \
  test >"$LOG" 2>&1 &
XB_PID=$!
echo "$XB_PID" > "$(pid_file xcodebuild-wda)"; chmod 600 "$(pid_file xcodebuild-wda)"

log_info "waiting for WDA /status (timeout ${TIMEOUT}s)..."
ELAPSED=0
while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  if wda_status_ok "127.0.0.1:$WDA_PORT"; then
    break
  fi
  if ! proc_alive "$XB_PID"; then
    log_error "xcodebuild exited before WDA came up. Tail of log:"
    tail -n 20 "$LOG" >&2 || true
    die "re-sign FAILED — phone locked? team misconfigured? See $LOG and DEPLOY.md troubleshooting."
  fi
  sleep 5; ELAPSED=$((ELAPSED + 5))
done

if ! wda_status_ok "127.0.0.1:$WDA_PORT"; then
  kill "$XB_PID" 2>/dev/null || true
  log_error "timed out waiting for WDA. Tail of log:"
  tail -n 20 "$LOG" >&2 || true
  die "re-sign FAILED (exit 2)."
fi

# success — NOW read the new ground truth (never before)
NEW_EXP="$(wda_profile_expiry_iso)"
NEW_REMAIN="$(wda_signing_hours_remaining "$NEW_EXP")"
log_ok "re-sign SUCCEEDED — WDA answering on 127.0.0.1:$WDA_PORT"
echo "  new expiry: ${NEW_EXP:-unknown} (${NEW_REMAIN}h remaining)"
if [ "$REMAIN" != "expired" ] && [ "$REMAIN" != "unknown" ] && [ "$NEW_REMAIN" != "unknown" ] && [ "$NEW_REMAIN" != "expired" ] \
   && [ "$NEW_REMAIN" -le "$REMAIN" ] 2>/dev/null; then
  log_warn "clock did not move — expected: Apple pins re-signs to the original 7-day window. It resets with the first sign AFTER expiry."
fi
echo "  xcodebuild (WDA server) kept running, pid $XB_PID. Stop it with: kill $XB_PID"
echo "  Next check: $SCRIPT_DIR/resign.sh --check   (suggested: weekly cron)"
exit 0
