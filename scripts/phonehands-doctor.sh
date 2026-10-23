#!/usr/bin/env bash
# SPDX-License-Identifier: BUSL-1.1
#
# phonehands-doctor: one-shot environment diagnosis for the phonehands device engine.
#
# Checks: OS, node (>=22), npm, python3 (>=3.9), usbmuxd, Xcode (macOS only),
# WebDriverAgent signing status (macOS only), tunnel tools (tailscale / ssh).
# Read-only: changes nothing on the system.
#
# Usage: phonehands-doctor.sh [--help]
# Exit: 0 = no FAILs, 1 = at least one FAIL.

set -euo pipefail

VERSION="0.1.0"

usage() {
  echo "phonehands-doctor v$VERSION — phonehands device-engine environment diagnosis (read-only)"
  cat <<'EOF'
Checks (each prints PASS / FAIL / WARN / SKIP):
  OS            macOS required for WDA signing; Linux can run API-side work
  node          >= 22 required (device tooling runs on Node)
  npm           bundled with node usually; needed for appium-ios-device
  python3       >= 3.9 required
  usbmuxd       USB multiplexer daemon (device <-> host link)
  xcode         full Xcode (macOS only; SKIP on Linux)
  wda-signing   WebDriverAgentRunner signed & provisioning not expired (macOS only)
  tailscale     WireGuard client (headscale mesh default / official opt-in fallback)
  ssh           required for the SSH reverse-tunnel fallback

Every FAIL prints a one-line fix command. Exit 0 = no FAILs, 1 = has FAILs.
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then usage; exit 0; fi
if [ $# -gt 0 ]; then echo "unknown argument: $1 (try --help)" >&2; exit 2; fi

if [ -t 1 ]; then
  C_GREEN=$'\033[0;32m'; C_RED=$'\033[0;31m'; C_YELLOW=$'\033[0;33m'
  C_GREY=$'\033[0;90m';  C_RESET=$'\033[0m'
else
  C_GREEN=""; C_RED=""; C_YELLOW=""; C_GREY=""; C_RESET=""
fi

FAIL=0
report() { # <STATUS> <name> <detail> [fix]
  local st="$1" name="$2" detail="$3" fix="${4:-}"
  local color="$C_GREEN"
  case "$st" in
    PASS) color="$C_GREEN" ;;
    FAIL) color="$C_RED"; FAIL=$((FAIL+1)) ;;
    WARN) color="$C_YELLOW" ;;
    SKIP) color="$C_GREY" ;;
  esac
  printf '%s[%-4s]%s %-12s %s\n' "$color" "$st" "$C_RESET" "$name" "$detail"
  [ -n "$fix" ] && printf '         %sfix:%s %s\n' "$C_YELLOW" "$C_RESET" "$fix"
  return 0  # last && above may return 1; never fail the caller on a report
}

OS="$(uname -s)"

# ------------------------------------------------------------------ OS
case "$OS" in
  Darwin) report PASS "os" "macOS — device engine supported" ;;
  Linux)  report WARN "os" "Linux — API side OK; WDA signing needs macOS" \
                    "run this on the Mac that will hold the iPhone" ;;
  *)      report WARN "os" "unrecognized OS: $OS" ;;
esac

# ------------------------------------------------------------------ node
if command -v node >/dev/null 2>&1; then
  NV="$(node -v 2>/dev/null || echo v0)"; NV="${NV#v}"
  MAJOR="${NV%%.*}"
  if [ "$MAJOR" -ge 22 ] 2>/dev/null; then
    report PASS "node" "v$NV (>= 22)"
  else
    report FAIL "node" "v$NV found, need >= 22" \
      "brew install node   # macOS  |  use nvm/fnm to install node 22+"
  fi
else
  report FAIL "node" "not found, need >= 22" \
    "brew install node   # macOS  |  curl -fsSL https://fnm.vercel.app/install | bash"
fi

# ------------------------------------------------------------------ npm
if command -v npm >/dev/null 2>&1; then
  report PASS "npm" "$(npm -v 2>/dev/null)"
else
  report WARN "npm" "not found (usually ships with node)" \
    "reinstall node from nodejs.org or: brew reinstall node"
fi

# ------------------------------------------------------------------ python3
if command -v python3 >/dev/null 2>&1; then
  PYN="$(python3 -c 'import sys; print(sys.version_info[0]*100+sys.version_info[1])' 2>/dev/null || echo 0)"
  if [ "$PYN" -ge 309 ] 2>/dev/null; then
    report PASS "python3" "$(python3 --version 2>&1) (>= 3.9)"
  else
    report FAIL "python3" "$(python3 --version 2>&1), need >= 3.9" \
      "brew install python3   # macOS"
  fi
else
  report FAIL "python3" "not found, need >= 3.9" \
    "brew install python3   # macOS  |  apt install python3   # linux"
fi

# ------------------------------------------------------------------ usbmuxd
USBMUX_OK=0
if command -v usbmuxd >/dev/null 2>&1; then USBMUX_OK=1; fi
if command -v pgrep >/dev/null 2>&1 && pgrep -x usbmuxd >/dev/null 2>&1; then USBMUX_OK=1; fi
if [ "$USBMUX_OK" = "1" ]; then
  report PASS "usbmuxd" "present (USB link daemon)"
else
  report WARN "usbmuxd" "not detected — needed for the USB device link" \
    "brew install --cask usbmuxd  # macOS  |  apt install usbmuxd  # linux"
fi

# ------------------------------------------------------------------ xcode (macOS only)
if [ "$OS" = "Darwin" ]; then
  if [ -d "/Applications/Xcode.app" ] && command -v xcodebuild >/dev/null 2>&1; then
    XV="$(xcodebuild -version 2>/dev/null | head -n 1 || echo unknown)"
    report PASS "xcode" "$XV (full Xcode)"
  elif command -v xcodebuild >/dev/null 2>&1; then
    report FAIL "xcode" "only Command Line Tools detected — full Xcode required for WDA signing" \
      "install Xcode from the Mac App Store, then: sudo xcode-select -s /Applications/Xcode.app"
  else
    report FAIL "xcode" "not found — full Xcode required for WDA signing" \
      "install Xcode from the Mac App Store"
  fi
else
  report SKIP "xcode" "macOS-only check (WDA signing needs a Mac)"
fi

# ------------------------------------------------------------------ wda signing (macOS only)
if [ "$OS" = "Darwin" ]; then
  WDA_APP="$(find "$HOME/Library/Developer/Xcode/DerivedData" -maxdepth 6 \
    -path '*Debug-iphoneos/WebDriverAgentRunner.app' -type d 2>/dev/null | head -n 1 || true)"
  if [ -z "$WDA_APP" ]; then
    report WARN "wda-signing" "no signed WebDriverAgentRunner.app found in DerivedData" \
      "run scripts/remote-topology/setup.sh — it walks you through the one manual signing step"
  else
    PROV="$WDA_APP/embedded.mobileprovision"
    if [ -f "$PROV" ]; then
      EXP="$(security cms -D -i "$PROV" 2>/dev/null | plutil -extract ExpirationDate raw - 2>/dev/null || true)"
      if [ -n "$EXP" ]; then
        EXPIRED="$(python3 -c "
import sys, datetime
try:
    exp = datetime.datetime.fromisoformat('$EXP'.replace('Z','+00:00'))
    print('yes' if exp < datetime.datetime.now(datetime.timezone.utc) else 'no')
except Exception:
    print('unknown')" 2>/dev/null || echo unknown)"
        case "$EXPIRED" in
          no)      report PASS "wda-signing" "signed; provisioning valid until $EXP" ;;
          yes)     report FAIL "wda-signing" "provisioning EXPIRED ($EXP) — free Apple ID signatures last 7 days" \
                             "re-run Xcode Product -> Test to re-sign (see DEPLOY.md)" ;;
          *)       report WARN "wda-signing" "signed app found, could not parse expiry ($EXP)" \
                             "re-sign if WDA refuses to launch" ;;
        esac
      else
        report WARN "wda-signing" "signed app found, could not read provisioning profile" \
          "re-sign if WDA refuses to launch"
      fi
    else
      report WARN "wda-signing" "app found but no embedded.mobileprovision" \
        "re-run Xcode Product -> Test to re-sign"
    fi
  fi
else
  report SKIP "wda-signing" "macOS-only check (run on the Mac holding the iPhone)"
fi

# ------------------------------------------------------------------ tailscale
# The tailscale CLIENT binary is the WireGuard client for both headscale
# (self-hosted, default) and official Tailscale (opt-in fallback).
if command -v tailscale >/dev/null 2>&1; then
  if tailscale status >/dev/null 2>&1; then
    report PASS "tailscale" "client installed and joined (headscale or official)"
  else
    report WARN "tailscale" "client installed but not joined to any control server" \
      "setup.sh joins it to your headscale server automatically (or: tailscale up for official)"
  fi
else
  report WARN "tailscale" "client not installed — needed for the headscale mesh leg" \
    "brew install tailscale   # macOS (client only; control plane is your headscale server)"
fi

# ------------------------------------------------------------------ ssh
if command -v ssh >/dev/null 2>&1; then
  report PASS "ssh" "present (reverse-tunnel fallback)"
else
  report FAIL "ssh" "not found — needed for the SSH tunnel fallback" \
    "install OpenSSH for your OS"
fi

# ------------------------------------------------------------------ summary
echo
if [ "$FAIL" -gt 0 ]; then
  printf '%sphonehands-doctor: %d FAIL item(s) — fix the lines above, then re-run.%s\n' \
    "$C_RED" "$FAIL" "$C_RESET"
  exit 1
fi
printf '%sphonehands-doctor: all checks PASS (warnings above are non-blocking).%s\n' \
  "$C_GREEN" "$C_RESET"
exit 0
