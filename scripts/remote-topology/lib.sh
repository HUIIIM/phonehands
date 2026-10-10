#!/usr/bin/env bash
# SPDX-License-Identifier: BUSL-1.1 (pending GC final review)
#
# phonehands remote-topology shared helpers.
# Sourced (not executed) by setup.sh and healthcheck.sh.
# No secrets are ever read, stored, or printed here.

# Re-exec guard: safe to source twice.
[ -n "${PHONEHANDS_LIB_LOADED:-}" ] && return 0
PHONEHANDS_LIB_LOADED=1

# ---------------------------------------------------------------- colors/log
if [ -t 1 ]; then
  C_GREEN=$'\033[0;32m'; C_RED=$'\033[0;31m'; C_YELLOW=$'\033[0;33m'
  C_BLUE=$'\033[0;34m'; C_RESET=$'\033[0m'
else
  C_GREEN=""; C_RED=""; C_YELLOW=""; C_BLUE=""; C_RESET=""
fi

log_info()  { printf '%s[INFO]%s %s\n'  "$C_BLUE"   "$C_RESET" "$*"; }
log_ok()    { printf '%s[ OK ]%s %s\n'  "$C_GREEN"  "$C_RESET" "$*"; }
log_warn()  { printf '%s[WARN]%s %s\n'  "$C_YELLOW" "$C_RESET" "$*"; }
log_error() { printf '%s[FAIL]%s %s\n'  "$C_RED"    "$C_RESET" "$*" >&2; }

die() { log_error "$*"; exit 1; }

# ------------------------------------------------------- secret hygiene
# redact: mask the *values* of any env var whose name looks like a secret,
# so we can safely echo a string that might embed them.
redact() {
  local s="$1" var val
  while IFS='=' read -r var val; do
    case "$var" in
      *TOKEN*|*SECRET*|*PASSWORD*|*API_KEY*|*PRIVATE_KEY*|*AUTH*|*CREDENTIAL*)
        [ -n "$val" ] && s="${s//"$val"/[REDACTED]}"
        ;;
    esac
  done < <(env -0 2>/dev/null | tr '\0' '\n')
  printf '%s' "$s"
}

# log_cmd: echo a command for transparency, with secret values masked.
log_cmd() { log_info "  $ $(redact "$*")"; }

# ------------------------------------------------------- environment
# PHONEHANDS_DIR: state dir (pid files, endpoint file). 0700 per security posture.
PHONEHANDS_DIR="${PHONEHANDS_DIR:-$HOME/.phonehands}"
ensure_dir() {
  mkdir -p "$PHONEHANDS_DIR"
  chmod 700 "$PHONEHANDS_DIR"
}

iso_now() {
  python3 -c 'import datetime; print(datetime.datetime.now(datetime.timezone.utc).astimezone().isoformat())'
}

# ------------------------------------------------------- processes
# pid_file <name> -> path
pid_file() { printf '%s/%s.pid' "$PHONEHANDS_DIR" "$1"; }

# proc_alive <pid> -> 0/1
proc_alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

# start_bg <name> <cmd...>: idempotent background start; kills stale pid first.
start_bg() {
  local name="$1"; shift
  local pf; pf="$(pid_file "$name")"
  if [ -f "$pf" ]; then
    local old; old="$(cat "$pf" 2>/dev/null || true)"
    if proc_alive "$old"; then
      log_info "'$name' already running (pid $old), reusing."
      return 0
    fi
    rm -f "$pf"
  fi
  log_cmd "$*"
  "$@" >/dev/null 2>&1 &
  local pid=$!
  echo "$pid" > "$pf"
  chmod 600 "$pf"
  sleep 1
  proc_alive "$pid" || die "'$name' failed to start (see command above)."
  log_ok "'$name' started (pid $pid)."
}

stop_bg() {
  local name="$1"; local pf; pf="$(pid_file "$name")"
  [ -f "$pf" ] || return 0
  local pid; pid="$(cat "$pf" 2>/dev/null || true)"
  if proc_alive "$pid"; then kill "$pid" 2>/dev/null || true; fi
  rm -f "$pf"
}

# ------------------------------------------------------- http helpers
# http_get <url> -> prints body; returns curl exit code. Never prints secrets.
http_get() {
  curl -sS -m 15 -o /dev/stdout -w '\n%{http_code}' "$1"
}

# wda_status_ok <host:port> -> 0 if /status returns 200 and JSON has "value"
wda_status_ok() {
  local ep="$1" out code body
  out="$(curl -sS -m 15 "http://$ep/status" -w '\n%{http_code}' 2>/dev/null)" || return 1
  code="$(printf '%s' "$out" | tail -n 1)"
  body="$(printf '%s' "$out" | sed '$d')"
  [ "$code" = "200" ] || return 1
  printf '%s' "$body" | python3 -c 'import sys,json; d=json.load(sys.stdin); sys.exit(0 if isinstance(d.get("value"),dict) else 1)' 2>/dev/null
}

# ------------------------------------------------------- WDA signing expiry
# macOS-only helpers. All degrade gracefully on other OSes (empty output).
# The "truth" is the provisioning profile embedded in the signed WDA app
# currently on disk — state files are only updated AFTER a verified re-sign.

wda_app_path() {
  [ "$(uname -s)" = "Darwin" ] || return 0
  find "$HOME/Library/Developer/Xcode/DerivedData" -maxdepth 6 \
    -path '*Debug-iphoneos/WebDriverAgentRunner.app' -type d 2>/dev/null | head -n 1 || true
}

# wda_profile_expiry_iso -> ISO8601 expiry or empty
wda_profile_expiry_iso() {
  local app prov
  app="$(wda_app_path)"; [ -n "$app" ] || return 0
  prov="$app/embedded.mobileprovision"; [ -f "$prov" ] || return 0
  security cms -D -i "$prov" 2>/dev/null | plutil -extract ExpirationDate raw - 2>/dev/null || true
}

# wda_signing_hours_remaining -> integer hours, "expired", or "unknown"
wda_signing_hours_remaining() {
  local exp="$1"
  [ -n "$exp" ] || { echo "unknown"; return 0; }
  python3 -c "
import datetime
try:
    exp = datetime.datetime.fromisoformat('$exp'.replace('Z', '+00:00'))
    delta = (exp - datetime.datetime.now(datetime.timezone.utc)).total_seconds()
    print('expired' if delta <= 0 else str(int(delta // 3600)))
except Exception:
    print('unknown')" 2>/dev/null || echo "unknown"
}

# ------------------------------------------------------- endpoint file
# endpoint file format: {"endpoint":"host:port","tunnel_mode":"...",
#   "relay_url":"ssh://user@host:port | ws(s)://host:port/path",
#   "ssh_host":"user@relay" (ssh mode only),"wda_port":8100,"created_at":"..."}
# PHONEHANDS_RELAY_URL is the cross-platform relay convention (iOS + Android):
#   ssh://user@host:port   -> SSH reverse tunnel (self-hosted relay)
#   ws(s)://host:port/path -> directly dialable (Tailscale fallback / mock / Android WS)
write_endpoint() {
  local file="$1" endpoint="$2" mode="$3" ssh_host="${4:-}" wda_port="${5:-8100}" relay_url="${6:-}"
  python3 - "$file" "$endpoint" "$mode" "$ssh_host" "$wda_port" "$relay_url" <<'EOF'
import json, sys, datetime
path, endpoint, mode, ssh_host, wda_port, relay_url = sys.argv[1:7]
doc = {
    "endpoint": endpoint,
    "tunnel_mode": mode,
    "wda_port": int(wda_port),
    "created_at": datetime.datetime.now(datetime.timezone.utc).astimezone().isoformat(),
}
if ssh_host:
    doc["ssh_host"] = ssh_host
if relay_url:
    doc["relay_url"] = relay_url
with open(path, "w") as f:
    json.dump(doc, f, indent=2)
EOF
  chmod 600 "$file"
}

read_endpoint() {
  local file="$1"
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["endpoint"])' "$file" 2>/dev/null
}
