#!/usr/bin/env bash
# SPDX-License-Identifier: BUSL-1.1 (pending GC final review)
#
# healthcheck.sh — verify a phonehands remote operation endpoint.
#
# Unified health schema (shared with the Android side; the Router parses it
# to dispatch by deviceType):
#   {"relay": str, "reachable": bool, "latency_ms": int,
#    "path": "ssh-tunnel"|"headscale"|"tailscale"|"direct"|"usb"}
# This script always emits those four top-level keys, plus a "detail" object
# with iOS/WDA-specific evidence. --parse-json validates & summarizes any
# JSON in this schema (either side's output).
#
# Relay input: --endpoint host:port | $PHONEHANDS_RELAY_URL | --endpoint-file
#   PHONEHANDS_RELAY_URL formats:
#     ssh://user@host:port    SSH reverse tunnel (self-hosted relay)
#     ws(s)://host:port/path  directly dialable (headscale/Tailscale/mock/Android WS)
#
# Checks:
#   1. WDA /status  -> HTTP 200 + JSON {"value": {...}}
#   2. /screenshot  -> one real screenshot, PNG magic bytes verified
#      (proves the full chain: endpoint -> tunnel -> WDA -> device screen)
#   3. relay path   -> traffic must stay on the user's own infrastructure:
#                      ssh-tunnel / headscale / loopback = PASS,
#                      official Tailscale = WARN (fallback, third-party account),
#                      third-party cloud relay = FAIL.
#
# Prints a JSON result to stdout. Exit 0 = reachable, 1 = not.
# Read-only: takes one screenshot, stores it where you tell it, changes nothing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

VERSION="0.2.0"
ENDPOINT=""; ENDPOINT_FILE=""; SHOT_DIR="${TMPDIR:-/tmp}/phonehands-healthcheck"; JSON_ONLY=0
PARSE_JSON=""

usage() {
  awk 'NR>1 && /^set -euo pipefail$/ {exit} NR>1 {sub(/^# ?/, ""); print}' "$0"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --endpoint)        ENDPOINT="$2"; shift 2 ;;
    --endpoint-file)   ENDPOINT_FILE="$2"; shift 2 ;;
    --screenshot-dir)  SHOT_DIR="$2"; shift 2 ;;
    --json-only)       JSON_ONLY=1; shift ;;
    --parse-json)      PARSE_JSON="$2"; shift 2 ;;
    --help|-h)         usage; exit 0 ;;
    *)                 die "unknown argument: $1 (try --help)" ;;
  esac
done

# ------------------------------------------------- --parse-json mode
# Validates & summarizes ANY unified-schema health JSON (iOS or Android side).
if [ -n "$PARSE_JSON" ]; then
  [ -f "$PARSE_JSON" ] || die "file not found: $PARSE_JSON"
  python3 - "$PARSE_JSON" <<'EOF'
import json, sys
path = sys.argv[1]
try:
    d = json.load(open(path))
except Exception as e:
    print(f"PARSE FAIL: not valid JSON ({e})"); sys.exit(2)
required = {"relay": str, "reachable": bool, "latency_ms": int, "path": str}
problems = []
for k, t in required.items():
    if k not in d: problems.append(f"missing key: {k}")
    elif not isinstance(d[k], t): problems.append(f"bad type for {k}: expected {t.__name__}")
valid_paths = {"ssh-tunnel", "headscale", "tailscale", "direct", "usb"}
if "path" in d and d["path"] not in valid_paths:
    problems.append(f"bad path enum: {d['path']!r} (want one of {sorted(valid_paths)})")
if problems:
    print("SCHEMA INVALID:"); [print(" -", p) for p in problems]; sys.exit(2)
r = "REACHABLE" if d["reachable"] else "UNREACHABLE"
print(f"{r} | path={d['path']} | relay={d['relay']} | latency={d['latency_ms']}ms")
sys.exit(0 if d["reachable"] else 1)
EOF
  exit $?
fi

# ------------------------------------------------- resolve relay + endpoint
# Precedence: --endpoint > $PHONEHANDS_RELAY_URL > --endpoint-file
RELAY_URL="${PHONEHANDS_RELAY_URL:-}"
TUNNEL_MODE=""; SSH_HOST=""
if [ -n "$ENDPOINT_FILE" ]; then
  [ -f "$ENDPOINT_FILE" ] || die "endpoint file not found: $ENDPOINT_FILE"
  [ -z "$ENDPOINT" ] && ENDPOINT="$(read_endpoint "$ENDPOINT_FILE")"
  TUNNEL_MODE="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("tunnel_mode",""))' "$ENDPOINT_FILE" 2>/dev/null || true)"
  SSH_HOST="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("ssh_host",""))' "$ENDPOINT_FILE" 2>/dev/null || true)"
  [ -z "$RELAY_URL" ] && RELAY_URL="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("relay_url",""))' "$ENDPOINT_FILE" 2>/dev/null || true)"
fi

# Parse PHONEHANDS_RELAY_URL into endpoint + path class.
URL_PATH_CLASS=""
if [ -z "$ENDPOINT" ] && [ -n "$RELAY_URL" ]; then
  case "$RELAY_URL" in
    ssh://*)
      URL_PATH_CLASS="ssh-tunnel"
      REST="${RELAY_URL#ssh://}"; REST="${REST%%/*}"
      ENDPOINT="${REST##*@}" ;;                        # strip user@
    ws://*|wss://*)
      URL_PATH_CLASS="direct"
      REST="${RELAY_URL#*://}"; REST="${REST%%/*}"
      ENDPOINT="$REST" ;;
    *) die "bad PHONEHANDS_RELAY_URL scheme (want ssh:// or ws(s)://): $(redact "$RELAY_URL")" ;;
  esac
fi
[ -n "$ENDPOINT" ] || die "no endpoint: pass --endpoint host:port, set PHONEHANDS_RELAY_URL, or use --endpoint-file"
HOST="${ENDPOINT%%:*}"
[ -z "$RELAY_URL" ] && RELAY_URL="direct://${ENDPOINT}/"

[ "$JSON_ONLY" = "1" ] || log_info "healthcheck v$VERSION — endpoint $ENDPOINT (tunnel_mode=${TUNNEL_MODE:-unknown})"

# ------------------------------------------------- 1. WDA /status
WDA_HTTP=0; WDA_STATE=""; LAT_MS=0; STATUS_OK=0
T0=$(date +%s%3N 2>/dev/null || date +%s)
RAW="$(curl -sS -m 15 "http://$ENDPOINT/status" -w '\n%{http_code}' 2>/dev/null)" || RAW=""
T1=$(date +%s%3N 2>/dev/null || date +%s)
case "$T0$T1" in *N*) LAT_MS=0 ;; *) LAT_MS=$(( (10#$T1 - 10#$T0) )) ;; esac
if [ -n "$RAW" ]; then
  WDA_HTTP="$(printf '%s' "$RAW" | tail -n 1)"
  BODY="$(printf '%s' "$RAW" | sed '$d')"
  if [ "$WDA_HTTP" = "200" ]; then
    WDA_STATE="$(printf '%s' "$BODY" | python3 -c '
import sys, json
try:
    v = json.load(sys.stdin).get("value", {})
    print(v.get("state", "unknown") if isinstance(v, dict) else "unknown")
except Exception:
    print("unparseable")' 2>/dev/null || echo unparseable)"
    [ "$WDA_STATE" != "unparseable" ] && STATUS_OK=1
  fi
fi

# ------------------------------------------------- 2. screenshot chain proof
mkdir -p "$SHOT_DIR"; chmod 700 "$SHOT_DIR"
SHOT_OK=0; SHOT_PATH=""
if [ "$STATUS_OK" = "1" ]; then
  SRAW="$(curl -sS -m 20 "http://$ENDPOINT/screenshot" 2>/dev/null || true)"
  if [ -n "$SRAW" ]; then
    SHOT_PATH="$SHOT_DIR/shot-$(date +%Y%m%d-%H%M%S).png"
    if printf '%s' "$SRAW" | python3 -c '
import sys, json, base64
raw = sys.stdin.read()
try:
    b64 = json.loads(raw)["value"]
except Exception:
    sys.exit(1)
data = base64.b64decode(b64)
if data[:8] != b"\x89PNG\r\n\x1a\n":
    sys.exit(2)
open(sys.argv[1], "wb").write(data)
' "$SHOT_PATH" 2>/dev/null; then
      SHOT_OK=1
      chmod 600 "$SHOT_PATH"
    else
      SHOT_PATH=""
    fi
  fi
fi

# ------------------------------------------------- 3. relay path verification
# Unified path enum: ssh-tunnel | headscale | tailscale | direct | usb
# Policy: screen stream + commands must stay on the user's own infrastructure.
RELAY_DETAIL="unknown"; RELAY_OK=0; RELAY_NOTE=""; PATH_ENUM="direct"
THIRD_PARTY_RE='(ngrok\.io|trycloudflare\.com|cfargotunnel\.com|bore\.pub|localhost\.run|localtunnel\.me|serveo\.net|tapkit\.)'
is_loopback() { case "$1" in 127.*|localhost|::1) return 0;; *) return 1;; esac; }

if printf '%s' "$HOST" | grep -Eq "$THIRD_PARTY_RE"; then
  RELAY_DETAIL="third-party-relay"; RELAY_OK=0; PATH_ENUM="direct"
  RELAY_NOTE="FAIL: endpoint uses a third-party cloud relay ($HOST) — screen/commands would cross someone else's servers. Use your own SSH relay or headscale."
elif [ -n "$SSH_HOST" ] && [ "$HOST" = "${SSH_HOST##*@}" ]; then
  RELAY_DETAIL="self-hosted-ssh"; RELAY_OK=1; PATH_ENUM="ssh-tunnel"
  RELAY_NOTE="endpoint is your own SSH relay host ($SSH_HOST) — self-hosted, no third-party cloud"
elif [ "$URL_PATH_CLASS" = "ssh-tunnel" ]; then
  RELAY_DETAIL="ssh-tunnel-url"; RELAY_OK=1; PATH_ENUM="ssh-tunnel"
  RELAY_NOTE="PHONEHANDS_RELAY_URL declares an SSH-tunnel relay — self-hosted path"
elif [ "$TUNNEL_MODE" = "headscale" ]; then
  RELAY_DETAIL="self-hosted-headscale"; RELAY_OK=1; PATH_ENUM="headscale"
  RELAY_NOTE="your own headscale control plane + WireGuard p2p data — coordination server is yours too"
elif [ "$TUNNEL_MODE" = "tailscale" ] || [ "$TUNNEL_MODE" = "tailscale-official" ]; then
  RELAY_DETAIL="tailscale-official-fallback"; RELAY_OK=1; PATH_ENUM="tailscale"
  RELAY_NOTE="WARN: official Tailscale fallback — data is WireGuard p2p but login/coordination depends on a third-party account. Prefer headscale or SSH."
elif is_loopback "$HOST" && [ "$TUNNEL_MODE" = "mock" ]; then
  RELAY_DETAIL="mock"; RELAY_OK=1; PATH_ENUM="direct"
  RELAY_NOTE="mock tunnel (test only — not a real relay path)"
elif is_loopback "$HOST"; then
  RELAY_DETAIL="loopback-usb-host"; RELAY_OK=1; PATH_ENUM="usb"
  RELAY_NOTE="running on the Mac itself — traffic goes Mac -> USB -> WDA, never leaves the machine"
elif [ "$URL_PATH_CLASS" = "direct" ]; then
  RELAY_DETAIL="direct-url"; RELAY_OK=1; PATH_ENUM="direct"
  RELAY_NOTE="WARN: directly dialable address ($HOST) — confirm it is your own infrastructure (your headscale node / relay), not a third-party cloud."
else
  RELAY_DETAIL="unrecognized-external"; RELAY_OK=1; PATH_ENUM="direct"
  RELAY_NOTE="WARN: external address not recognized as your infrastructure — confirm $HOST is yours before operating."
fi

# ------------------------------------------------- verdict + unified JSON
REACHABLE=0
[ "$STATUS_OK" = "1" ] && [ "$SHOT_OK" = "1" ] && [ "$RELAY_OK" = "1" ] && REACHABLE=1

python3 - "$RELAY_URL" "$REACHABLE" "$LAT_MS" "$PATH_ENUM" "$ENDPOINT" \
           "$WDA_HTTP" "$WDA_STATE" "$SHOT_OK" "$SHOT_PATH" \
           "$RELAY_DETAIL" "$RELAY_OK" "$RELAY_NOTE" <<'EOF'
import json, sys, datetime
(relay, reachable, lat, path, ep, http, state, shot_ok, shot_path,
 rdetail, rok, rnote) = sys.argv[1:13]
print(json.dumps({
    # ---- unified schema (iOS + Android; Router parses these four) ----
    "relay": relay,
    "reachable": reachable == "1",
    "latency_ms": int(lat),
    "path": path,
    # ---- iOS/WDA detail ----
    "checked_at": datetime.datetime.now(datetime.timezone.utc).astimezone().isoformat(),
    "endpoint": ep,
    "wda": {"http": int(http), "state": state},
    "screenshot": {"ok": shot_ok == "1", "path": shot_path or None},
    "relay_check": {"ok": rok == "1", "detail": rdetail, "note": rnote},
}, indent=2, ensure_ascii=False))
EOF

if [ "$JSON_ONLY" = "0" ]; then
  if [ "$REACHABLE" = "1" ]; then
    log_ok "healthcheck PASS — reachable via path=$PATH_ENUM, WDA live, screenshot chain verified"
  else
    log_error "healthcheck FAIL — status_ok=$STATUS_OK shot_ok=$SHOT_OK relay=$RELAY_DETAIL($RELAY_OK)"
  fi
fi
[ "$REACHABLE" = "1" ]
