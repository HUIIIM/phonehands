#!/usr/bin/env bash
# SPDX-License-Identifier: BUSL-1.1
#
# test-mock.sh — mock verification for the remote-topology chain.
#
# Spins up a mock WDA (python3 http.server answering /status 200 and
# /screenshot with a real PNG), then verifies:
#   1. setup.sh --mock brings up the mock tunnel and writes endpoint.json
#      (incl. PHONEHANDS_RELAY_URL) — brew/Xcode/signing steps are skipped and
#      marked MANUALLY-ON-MAC.
#   2. healthcheck.sh passes through the tunnel endpoint AND emits the
#      unified schema {relay, reachable, latency_ms, path}.
#   3. healthcheck.sh --parse-json validates the unified schema
#      (reserved parsing for the Android side's outputs).
#   4. relay-path policy: a third-party relay hostname FAILs the check.
#   5. resign.sh --check degrades gracefully off-macOS.
#   6. setup.sh --mock is idempotent (second run also passes).
#
# Usage: test-mock.sh [--wda-port P] [--tunnel-port P]
# Exit: 0 = all PASS, 1 = any FAIL.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

WDA_PORT=18210; TUNNEL_PORT=18211
while [ $# -gt 0 ]; do
  case "$1" in
    --wda-port) WDA_PORT="$2"; shift 2 ;;
    --tunnel-port) TUNNEL_PORT="$2"; shift 2 ;;
    --help|-h) awk 'NR>1 && /^set -euo pipefail$/ {exit} NR>1 {sub(/^# ?/, ""); print}' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

TMP="$(mktemp -d)"; export PHONEHANDS_DIR="$TMP/state"
export PHONEHANDS_WDA_PORT="$WDA_PORT" PHONEHANDS_MOCK_TUNNEL_PORT="$TUNNEL_PORT"
EP_FILE="$TMP/endpoint.json"

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  [PASS] $*"; }
fail() { FAIL=$((FAIL+1)); echo "  [FAIL] $*" >&2; }

cleanup() {
  # kill everything we started; never touch the real ~/.phonehands
  for p in "$TMP"/wda.pid "$PHONEHANDS_DIR"/mock-relay.pid; do
    [ -f "$p" ] && kill "$(cat "$p" 2>/dev/null)" 2>/dev/null || true
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "== test-mock: remote-topology chain =="
echo "   mock WDA : 127.0.0.1:$WDA_PORT | mock tunnel : 127.0.0.1:$TUNNEL_PORT"

# ------------------------------------------------- mock WDA
cat > "$TMP/mock-wda.py" <<'PYEOF'
import json, base64
from http.server import BaseHTTPRequestHandler, HTTPServer
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
class H(BaseHTTPRequestHandler):
    def _send(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        if self.path == "/status":
            self._send({"value": {"state": "success", "ready": True, "os": {"name": "iOS"}}, "sessionId": "mock-session"})
        elif self.path == "/screenshot":
            self._send({"value": base64.b64encode(PNG).decode()})
        else:
            self.send_response(404); self.end_headers()
    def log_message(self, *a): pass
import sys
HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PYEOF
python3 "$TMP/mock-wda.py" "$WDA_PORT" >/dev/null 2>&1 &
echo $! > "$TMP/wda.pid"
sleep 1
if curl -sS -m 5 "http://127.0.0.1:$WDA_PORT/status" | grep -q '"state": "success"'; then
  pass "mock WDA answers /status 200"
else
  fail "mock WDA did not start"; exit 1
fi

# ------------------------------------------------- 1. setup.sh --mock
echo "-- 1. setup.sh --mock"
SETUP_OUT="$TMP/setup.out"
if "$SCRIPT_DIR/setup.sh" --mock --yes --endpoint-file "$EP_FILE" >"$SETUP_OUT" 2>&1; then
  pass "setup.sh --mock exited 0"
else
  fail "setup.sh --mock exited non-zero"; tail -n 15 "$SETUP_OUT" >&2
fi
grep -q "MANUALLY-ON-MAC" "$SETUP_OUT" && pass "mac-only steps marked MANUALLY-ON-MAC" \
  || fail "MANUALLY-ON-MAC marker missing"
RELAY_URL="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("relay_url",""))' "$EP_FILE" 2>/dev/null || true)"
[ "$RELAY_URL" = "ws://127.0.0.1:$TUNNEL_PORT/" ] && pass "PHONEHANDS_RELAY_URL=$RELAY_URL" \
  || fail "bad relay_url in endpoint.json: $RELAY_URL"
TMODE="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("tunnel_mode",""))' "$EP_FILE" 2>/dev/null || true)"
[ "$TMODE" = "mock" ] && pass "tunnel_mode=mock recorded" || fail "tunnel_mode=$TMODE"

# ------------------------------------------------- 2. healthcheck through tunnel (unified schema)
echo "-- 2. healthcheck.sh (tunnel endpoint, unified schema)"
HC_JSON="$TMP/hc.json"
if "$SCRIPT_DIR/healthcheck.sh" --endpoint-file "$EP_FILE" --json-only >"$HC_JSON" 2>"$TMP/hc.err"; then
  pass "healthcheck exited 0 through mock tunnel"
else
  fail "healthcheck failed through mock tunnel"; cat "$TMP/hc.err" >&2
fi
python3 - "$HC_JSON" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
req = {"relay": str, "reachable": bool, "latency_ms": int, "path": str}
bad = [k for k, t in req.items() if not isinstance(d.get(k), t)]
assert not bad, f"unified schema keys missing/mistyped: {bad}"
assert d["reachable"] is True, "reachable should be true"
assert d["path"] == "direct", f"path should be 'direct', got {d['path']!r}"
assert d["relay"].startswith("ws://"), f"relay should be ws://..., got {d['relay']!r}"
assert d["screenshot"]["ok"] is True, "screenshot chain proof failed"
assert d["latency_ms"] >= 0
print("  [PASS] unified schema {relay, reachable, latency_ms, path} valid; screenshot chain ok")
EOF
[ $? -eq 0 ] || FAIL=$((FAIL+1))

# ------------------------------------------------- 3. --parse-json (reserved parsing)
echo "-- 3. healthcheck.sh --parse-json"
if "$SCRIPT_DIR/healthcheck.sh" --parse-json "$HC_JSON" >/dev/null 2>&1; then
  pass "--parse-json accepts unified schema"
else
  fail "--parse-json rejected valid schema"
fi
echo '{"relay":"x","reachable":"yes"}' > "$TMP/bad.json"
if "$SCRIPT_DIR/healthcheck.sh" --parse-json "$TMP/bad.json" >/dev/null 2>&1; then
  fail "--parse-json accepted invalid schema"
else
  pass "--parse-json rejects invalid schema"
fi

# ------------------------------------------------- 4. relay-path policy: third-party FAIL
echo "-- 4. relay-path policy"
TP_JSON="$TMP/tp.json"
PHONEHANDS_RELAY_URL="ws://evil.ngrok.io:443/" "$SCRIPT_DIR/healthcheck.sh" \
  --endpoint "evil.ngrok.io:443" --json-only >"$TP_JSON" 2>/dev/null || true
python3 - "$TP_JSON" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
assert d["reachable"] is False, "third-party relay must not be reachable=true"
assert d["relay_check"]["ok"] is False, "relay_check.ok must be false"
assert d["relay_check"]["detail"] == "third-party-relay", d["relay_check"]
print("  [PASS] third-party cloud relay FAILs relay-path verification")
EOF
[ $? -eq 0 ] || FAIL=$((FAIL+1))

# ------------------------------------------------- 5. resign.sh off-macOS
echo "-- 5. resign.sh --check (non-macOS)"
if "$SCRIPT_DIR/resign.sh" --check >/dev/null 2>&1; then
  pass "resign.sh degrades gracefully off-macOS (exit 0)"
else
  fail "resign.sh --check failed off-macOS"
fi

# ------------------------------------------------- 6. idempotent re-run
echo "-- 6. idempotent re-run"
if "$SCRIPT_DIR/setup.sh" --mock --yes --endpoint-file "$EP_FILE" >/dev/null 2>&1; then
  pass "second setup.sh --mock run also passes"
else
  fail "second setup.sh --mock run failed"
fi

echo
echo "== result: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
