#!/usr/bin/env bash
# SPDX-License-Identifier: BUSL-1.1
#
# phonehands remote-topology setup.sh — one-command remote topology deploy (Mac side).
#
# Pipeline: doctor -> brew deps -> WebDriverAgent source -> guided WDA signing
#           (the ONE manual step) -> USB forward (iproxy) -> tunnel
#           (headscale self-hosted = DEFAULT; SSH reverse = second self-hosted
#            leg; official Tailscale = opt-in fallback) -> endpoint file ->
#           healthcheck.
#
# Self-hosted relay policy: screen stream + commands travel ONLY over the
# user's own infrastructure — their headscale control plane (WireGuard mesh)
# or their own SSH relay — never through a third-party cloud. Not even the
# coordination server is third-party: headscale is self-hosted
# (juanfont/headscale, BSD-3 — see NOTICE, pending GC final ruling).
#
# Secrets policy: this script NEVER asks for, stores, or prints Apple IDs,
# passwords, or tokens. Signing happens by hand in Xcode. Tunnel auth is
# key-based SSH or headscale pre-auth keys — both created outside any log;
# secret VALUES are masked in output (see lib.sh redact()).
# System changes (brew installs, headscale server install) are announced
# first and need confirmation unless --yes is passed. Safe to re-run.
#
# Usage:
#   setup.sh [--mock] [--yes] [--skip-brew] [--skip-signing]
#            [--wda-port PORT] [--tunnel-port PORT]
#            [--endpoint-file PATH] [--tunnel-mode auto|headscale|ssh|tailscale-official|mock]
#            [--use-tailscale-official] [--headscale-install]
#
# Env:
#   PHONEHANDS_WDA_PORT          local WDA forward port (default 8100)
#   PHONEHANDS_MOCK_TUNNEL_PORT  mock tunnel listen port (default 18100)
#   PHONEHANDS_TUNNEL_MODE       auto|headscale|ssh|tailscale-official|mock
#                               (default auto = headscale, then SSH)
#   PHONEHANDS_SSH_TUNNEL_HOST   user@relay.example.com — used for the SSH leg
#                               AND as the headscale server host (for install)
#   PHONEHANDS_SSH_TUNNEL_PORT   remote port for ssh reverse tunnel (default 18100)
#   PHONEHANDS_SSH_TUNNEL_BIND   remote bind address for the reverse tunnel
#                               (default 127.0.0.1; WDA has NO auth — 0.0.0.0
#                               exposes full phone control to anyone who can
#                               reach the port. Put an authenticating proxy in
#                               front instead.)
#   PHONEHANDS_HEADSCALE_URL     e.g. http://relay.example.com:8080
#                               (derived from SSH host if unset)
#   PHONEHANDS_HEADSCALE_USER    headscale user name (default: phonehands)
#   PHONEHANDS_HEADSCALE_INSTALL=1  auto-install headscale server (else prompt)
#   PHONEHANDS_HEADSCALE_VERSION    override the pinned headscale release (e.g. v0.29.6);
#   PHONEHANDS_HEADSCALE_SHA256     ... then the sha256 of its linux binary is REQUIRED
#   PHONEHANDS_ENDPOINT_FILE     where to write endpoint.json
#   PHONEHANDS_WDA_DIR           where the WebDriverAgent source lives
#
# Relay convention (shared with the Android side, Router dispatches by
# deviceType): this script prints PHONEHANDS_RELAY_URL on success —
#   ssh://user@host:port   SSH reverse tunnel (self-hosted relay leg)
#   ws(s)://host:port/path directly dialable endpoint (headscale mesh /
#                          official-Tailscale fallback / mock)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

VERSION="0.1.0"
WDA_REPO="https://github.com/appium/WebDriverAgent.git"

MOCK=0; YES=0; SKIP_BREW=0; SKIP_SIGNING=0; HEADSCALE_INSTALL=0
WDA_PORT="${PHONEHANDS_WDA_PORT:-8100}"
MOCK_TUNNEL_PORT="${PHONEHANDS_MOCK_TUNNEL_PORT:-18100}"
TUNNEL_MODE="${PHONEHANDS_TUNNEL_MODE:-auto}"
ENDPOINT_FILE="${PHONEHANDS_ENDPOINT_FILE:-$HOME/.phonehands/endpoint.json}"
WDA_DIR="${PHONEHANDS_WDA_DIR:-$HOME/.phonehands/WebDriverAgent}"
HEADSCALE_USER="${PHONEHANDS_HEADSCALE_USER:-phonehands}"

usage() {
  awk 'NR>1 && /^set -euo pipefail$/ {exit} NR>1 {sub(/^# ?/, ""); print}' "$0"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --mock)          MOCK=1; TUNNEL_MODE="mock"; shift ;;
    --yes)           YES=1; shift ;;
    --skip-brew)     SKIP_BREW=1; shift ;;
    --skip-signing)  SKIP_SIGNING=1; shift ;;
    --wda-port)      WDA_PORT="$2"; shift 2 ;;
    --tunnel-port)   MOCK_TUNNEL_PORT="$2"; shift 2 ;;
    --endpoint-file) ENDPOINT_FILE="$2"; shift 2 ;;
    --tunnel-mode)   TUNNEL_MODE="$2"; shift 2 ;;
    --use-tailscale-official) TUNNEL_MODE="tailscale-official"; shift ;;
    --headscale-install) HEADSCALE_INSTALL=1; shift ;;
    --help|-h)       usage; exit 0 ;;
    *)               die "unknown argument: $1 (try --help)" ;;
  esac
done

case "$TUNNEL_MODE" in auto|headscale|ssh|tailscale-official|mock) ;; *) die "bad --tunnel-mode: $TUNNEL_MODE" ;; esac

OS="$(uname -s)"
if [ "$OS" != "Darwin" ] && [ "$MOCK" = "0" ]; then
  die "setup.sh must run on macOS (the Mac holding the iPhone). Use --mock for chain-logic testing on Linux."
fi
if [ "$MOCK" = "1" ] && [ "$TUNNEL_MODE" != "mock" ]; then
  die "--mock requires --tunnel-mode mock"
fi

ensure_dir

echo "================================================================"
echo " phonehands remote-topology setup v$VERSION"
echo " mode: $([ "$MOCK" = 1 ] && echo MOCK || echo REAL) | tunnel: $TUNNEL_MODE | wda_port: $WDA_PORT"
echo "================================================================"

# ---------------------------------------------------------- step 1: doctor
echo; log_info "STEP 1/6 — environment diagnosis"
if [ "$MOCK" = "0" ]; then
  if ! "$SCRIPT_DIR/../phonehands-doctor.sh"; then
    log_warn "doctor reported FAIL items."
    if [ "$YES" = "0" ]; then
      printf 'Continue anyway? [y/N] '; read -r ans
      [ "$ans" = "y" ] || [ "$ans" = "Y" ] || die "aborted — fix doctor FAILs first."
    else
      log_warn "--yes: continuing despite doctor FAILs."
    fi
  fi
else
  log_info "--mock: doctor skipped (marked MANUALLY-ON-MAC)."
fi

# ---------------------------------------------------------- step 2: deps
echo; log_info "STEP 2/6 — dependencies"
if [ "$MOCK" = "1" ] || [ "$SKIP_BREW" = "1" ]; then
  log_info "skipped ($([ "$MOCK" = 1 ] && echo "--mock" || echo "--skip-brew"))."
else
  command -v brew >/dev/null 2>&1 || die "Homebrew not found. Install it first: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
  PKGS="node python3 libimobiledevice tailscale curl git"
  MISSING=""
  for p in $PKGS; do
    case "$p" in
      tailscale) command -v tailscale >/dev/null 2>&1 || MISSING="$MISSING $p" ;;
      *)         brew list "$p" >/dev/null 2>&1 || MISSING="$MISSING $p" ;;
    esac
  done
  # tailscale is a cask
  if ! brew list --cask tailscale >/dev/null 2>&1 && ! command -v tailscale >/dev/null 2>&1; then
    MISSING="$MISSING --cask tailscale"
  fi
  if [ -n "$MISSING" ]; then
    log_info "About to install (system change — needs your OK):$MISSING"
    if [ "$YES" = "0" ]; then
      printf 'Install with Homebrew? [y/N] '; read -r ans
      [ "$ans" = "y" ] || [ "$ans" = "Y" ] || die "aborted — install the packages manually and re-run."
    fi
    # shellcheck disable=SC2086
    brew install $MISSING || brew install --cask tailscale
    log_ok "dependencies installed."
  else
    log_ok "all dependencies present."
  fi
fi

# ---------------------------------------------------------- step 3: WDA source
echo; log_info "STEP 3/6 — WebDriverAgent source"
if [ "$MOCK" = "1" ]; then
  log_info "--mock: WDA source skipped (marked MANUALLY-ON-MAC)."
else
  if [ -d "$WDA_DIR/.git" ]; then
    log_info "updating existing checkout at $WDA_DIR"
    git -C "$WDA_DIR" pull --ff-only || log_warn "git pull failed — continuing with existing checkout."
  else
    log_cmd "git clone --depth 1 $WDA_REPO $WDA_DIR"
    git clone --depth 1 "$WDA_REPO" "$WDA_DIR"
  fi
  log_ok "WDA source ready: $WDA_DIR"
fi

# ---------------------------------------------------------- step 4: signing (the ONE manual step)
echo; log_info "STEP 4/6 — WDA signing"
if [ "$MOCK" = "1" ] || [ "$SKIP_SIGNING" = "1" ]; then
  log_info "skipped (marked MANUALLY-ON-MAC)."
else
  cat <<'EOF'

  +------------------------------------------------------------------+
  |  *** THE ONE MANUAL STEP ***                                      |
  |  This script will NEVER ask for your Apple ID or password.        |
  |  Signing happens by your own hand, inside Xcode:                  |
  |                                                                   |
  |  1. On the iPhone: unlock it, tap Trust for this Mac, enable       |
  |     Settings -> Privacy & Security -> Developer Mode (reboot).    |
  |  2. In Xcode: open WebDriverAgent.xcodeproj (see path below).      |
  |  3. Select the WebDriverAgentRunner target -> Signing &           |
  |     Capabilities -> Team: pick YOUR Apple ID (free Personal Team  |
  |     is fine).                                                     |
  |  4. Menu: Product -> Test. Keep the iPhone unlocked.               |
  |  5. NOTE: a free Apple ID signature EXPIRES AFTER 7 DAYS.          |
  |     Re-run Product -> Test weekly (see DEPLOY.md).                 |
  +------------------------------------------------------------------+

EOF
  log_info "Xcode project: $WDA_DIR/WebDriverAgent.xcodeproj"
  printf 'Press ENTER when Xcode Product -> Test has finished (WDA installed on the iPhone)... '
  read -r _
  log_ok "signing step acknowledged — will verify via /status below."
fi

# ---------------------------------------------------------- step 5: USB forward
echo; log_info "STEP 5/6 — USB forward (device 8100 -> localhost:$WDA_PORT)"
if [ "$MOCK" = "1" ]; then
  log_info "--mock: expecting a mock WDA on 127.0.0.1:$WDA_PORT (started by test harness)."
  if wda_status_ok "127.0.0.1:$WDA_PORT"; then
    log_ok "mock WDA answers on 127.0.0.1:$WDA_PORT/status"
  else
    die "nothing answers on 127.0.0.1:$WDA_PORT/status — start the mock WDA first."
  fi
else
  command -v idevice_id >/dev/null 2>&1 || die "idevice_id missing (brew install libimobiledevice)."
  UDID="$(idevice_id -l 2>/dev/null | head -n 1 || true)"
  [ -n "$UDID" ] || die "no iPhone detected via USB. Plug it in, unlock, tap Trust, re-run."
  log_ok "iPhone detected: $UDID"
  if wda_status_ok "127.0.0.1:$WDA_PORT"; then
    log_info "port $WDA_PORT already serves WDA — reusing existing forward."
  else
    command -v iproxy >/dev/null 2>&1 || die "iproxy missing (brew install libimobiledevice)."
    start_bg "iproxy" iproxy "$WDA_PORT" 8100 "$UDID"
    log_info "waiting for WDA /status on 127.0.0.1:$WDA_PORT ..."
    for _ in $(seq 1 30); do
      wda_status_ok "127.0.0.1:$WDA_PORT" && break
      sleep 2
    done
    wda_status_ok "127.0.0.1:$WDA_PORT" \
      || die "WDA not answering. Make sure Xcode Product -> Test is running and the phone is unlocked."
    log_ok "WDA answering on 127.0.0.1:$WDA_PORT"
  fi
fi

# ---------------------------------------------------------- step 6: tunnel
echo; log_info "STEP 6/6 — tunnel (self-hosted: headscale mesh DEFAULT, SSH reverse second leg)"
TUNNEL_ENDPOINT=""; TUNNEL_REACHABLE_LOCAL=0; SSH_HOST_USED=""; HEADSCALE_URL_USED=""

# ------------------------------------------------- headscale (self-hosted control plane)
# Where the control server lives: your own server (PHONEHANDS_SSH_TUNNEL_HOST),
# or any URL you give via PHONEHANDS_HEADSCALE_URL. Never a third-party cloud.

headscale_resolve_url() {
  local url="${PHONEHANDS_HEADSCALE_URL:-}"
  local ssh_host="${PHONEHANDS_SSH_TUNNEL_HOST:-}"
  if [ -z "$url" ] && [ -n "$ssh_host" ]; then
    url="http://${ssh_host##*@}:8080"
  fi
  if [ -z "$url" ] && [ "$YES" = "0" ]; then
    printf 'headscale control-server URL (e.g. http://your-own-server:8080): '
    read -r url
  fi
  [ -n "$url" ] || die "headscale needs a control-server URL: set PHONEHANDS_HEADSCALE_URL or PHONEHANDS_SSH_TUNNEL_HOST."
  printf '%s' "$url"
}

headscale_server_ready() {
  # 0 = headscale binary present on the server (via SSH)
  local ssh_host="${PHONEHANDS_SSH_TUNNEL_HOST:-}"
  [ -n "$ssh_host" ] || return 1
  ssh -o ConnectTimeout=8 -o BatchMode=yes "$ssh_host" "command -v headscale >/dev/null 2>&1" 2>/dev/null
}

headscale_install_server() {
  local ssh_host="$1" server_url="$2"
  local srv_port
  case "$server_url" in http://*:*|https://*:*) srv_port="${server_url##*:}"; srv_port="${srv_port%%/*}";; *) srv_port="8080";; esac

  echo "  About to install on YOUR server $(redact "$ssh_host") (system change — needs your OK):"
  echo "    - download headscale binary (pinned version, sha256-verified) -> /usr/local/bin/headscale"
  echo "    - write /etc/headscale/config.yaml (minimal: MagicDNS on, no third-party DERP)"
  echo "    - enable + start systemd service 'headscale'"
  if [ "$YES" = "0" ] && [ "$HEADSCALE_INSTALL" = "0" ]; then
    printf '  Install headscale on the server? [y/N] '; read -r ans
    case "$ans" in y|Y) ;; *) die "aborted — install headscale manually (see DEPLOY.md) and re-run." ;; esac
  fi
  log_info "installing headscale ..."
  ssh "$ssh_host" "sudo -n true" 2>/dev/null \
    || die "need passwordless sudo on the server for the install (or install headscale manually per DEPLOY.md)."
  # Pinned release + sha256 (from upstream checksums.txt). The binary runs as a
  # root systemd service, so it is never installed unverified.
  local hs_ver="${PHONEHANDS_HEADSCALE_VERSION:-v0.29.6}" hs_sha=""
  if [ -n "${PHONEHANDS_HEADSCALE_VERSION:-}" ]; then
    hs_sha="${PHONEHANDS_HEADSCALE_SHA256:-}"
    [ -n "$hs_sha" ] || die "PHONEHANDS_HEADSCALE_VERSION override needs PHONEHANDS_HEADSCALE_SHA256 (from the release's checksums.txt)."
  fi
  ssh "$ssh_host" bash -s "$server_url" "$srv_port" "$hs_ver" "$hs_sha" <<'REMOTE_EOF'
set -euo pipefail
SERVER_URL="$1"; SRV_PORT="$2"; VER="$3"; SHA="$4"
[ "$(uname -s)" = "Linux" ] || { echo "headscale server install supports Linux only"; exit 1; }
case "$(uname -m)" in x86_64) ARCH=amd64;; aarch64|arm64) ARCH=arm64;; *) echo "unsupported arch"; exit 1;; esac
if [ -z "$SHA" ]; then
  case "$VER/$ARCH" in
    v0.29.6/amd64) SHA=7477c374949eea6fb7cf3cbff14dbef49e4d118d9a33557d6764a77ece617e53 ;;
    v0.29.6/arm64) SHA=7b3c792ebe10e1a81a0c8d9674aee8eb540e7dbb7ccb80a98b71024da4c72a48 ;;
    *) echo "no pinned sha256 for headscale $VER/$ARCH"; exit 1 ;;
  esac
fi
if ! command -v headscale >/dev/null 2>&1; then
  echo "downloading headscale $VER ($ARCH)..."
  TMP_BIN="$(mktemp)"
  trap 'rm -f "$TMP_BIN"' EXIT
  curl -fsSL "https://github.com/juanfont/headscale/releases/download/${VER}/headscale_${VER#v}_linux_${ARCH}" \
    -o "$TMP_BIN"
  echo "${SHA}  ${TMP_BIN}" | sha256sum -c --quiet - \
    || { echo "headscale checksum mismatch — refusing to install"; exit 1; }
  sudo install -m 0755 "$TMP_BIN" /usr/local/bin/headscale
fi
sudo mkdir -p /etc/headscale /var/lib/headscale
if [ ! -f /etc/headscale/config.yaml ]; then
  NOISE_KEY="$(openssl rand -hex 32)"
  sudo tee /etc/headscale/config.yaml >/dev/null <<YAML
server_url: ${SERVER_URL}
listen_addr: 0.0.0.0:${SRV_PORT}
noise:
  private_key: ${NOISE_KEY}
prefixes:
  v4: 100.64.0.0/10
  v6: fd7a:115c:a1e0::/48
derp:
  server:
    enabled: false
  urls: []
  paths: []
  auto_update_enabled: false
dns_config:
  override_local_dns: false
  base_domain: phonehands.tailnet
  magic_dns: true
  domains: []
  nameservers:
    - 1.1.1.1
YAML
  sudo chmod 600 /etc/headscale/config.yaml
fi
sudo tee /etc/systemd/system/headscale.service >/dev/null <<UNIT
[Unit]
Description=headscale - self-hosted Tailscale control server (phonehands)
After=network.target
[Service]
Type=simple
ExecStart=/usr/local/bin/headscale serve
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now headscale
sleep 3
sudo systemctl is-active --quiet headscale || { echo "headscale service failed to start"; sudo journalctl -u headscale -n 30 --no-pager; exit 1; }
echo "headscale server up: ${SERVER_URL}"
REMOTE_EOF
  log_ok "headscale server installed and running at $server_url"
}

headscale_join() {
  # $1 = control URL. Joins THIS Mac to it; prints the node's dialable address.
  local url="$1" ssh_host="${PHONEHANDS_SSH_TUNNEL_HOST:-}"
  local marker="$PHONEHANDS_DIR/headscale.json"

  command -v tailscale >/dev/null 2>&1 || die "tailscale client missing (brew install tailscale) — it is the WireGuard client even for headscale."

  # already joined? (idempotent re-run)
  if [ -f "$marker" ] && [ "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("url",""))' "$marker" 2>/dev/null)" = "$url" ] \
     && tailscale status >/dev/null 2>&1 && [ -n "$(tailscale ip -4 2>/dev/null | head -n 1)" ]; then
    log_info "this Mac is already joined to $url — reusing."
  else
    [ -n "$ssh_host" ] || die "node registration needs PHONEHANDS_SSH_TUNNEL_HOST (to mint a pre-auth key on your server)."
    if tailscale status >/dev/null 2>&1; then
      log_info "tailscale client is logged in elsewhere — logging out first (your nodes stay registered)."
      log_cmd "tailscale logout"
      tailscale logout >/dev/null 2>&1 || true
    fi
    log_info "minting a one-time pre-auth key on your server (value never logged)..."
    # shellcheck disable=SC2034
    HEADSCALE_AUTHKEY="$(ssh -o ConnectTimeout=10 "$ssh_host" \
      "headscale users create '${HEADSCALE_USER}' >/dev/null 2>&1 || true; headscale preauthkeys create --user '${HEADSCALE_USER}' --reusable --expiration 24h 2>/dev/null" \
      | grep -Eo '[A-Za-z0-9]{20,}' | tail -n 1)"
    [ -n "${HEADSCALE_AUTHKEY:-}" ] || die "could not mint a pre-auth key on the server."
    log_info "joining this Mac to your headscale server..."
    log_cmd "tailscale up --login-server=$url --authkey=[REDACTED] --hostname=phonehands-mac"
    tailscale up --login-server="$url" --authkey="$HEADSCALE_AUTHKEY" --hostname=phonehands-mac \
      || die "tailscale up failed — server reachable? key valid? See DEPLOY.md troubleshooting."
    unset HEADSCALE_AUTHKEY
    python3 - "$marker" "$url" <<'EOF'
import json, sys
m, u = sys.argv[1], sys.argv[2]
json.dump({"url": u}, open(m, "w"), indent=2)
EOF
    chmod 600 "$marker"
  fi

  local ip; ip="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
  [ -n "$ip" ] || die "joined but no Tailscale IP — see DEPLOY.md troubleshooting."

  # MagicDNS: prefer the stable name if it resolves locally.
  local node_name=""
  if [ -n "$ssh_host" ]; then
    node_name="$(ssh -o ConnectTimeout=10 "$ssh_host" \
      "headscale nodes list --user '${HEADSCALE_USER}' 2>/dev/null" | grep -i "phonehands-mac" | awk '{print $2}' | head -n 1 || true)"
  fi
  local dial="$ip"
  if [ -n "$node_name" ]; then
    local fqdn="${node_name}.phonehands.tailnet"
    if python3 -c "import socket; socket.gethostbyname('$fqdn')" 2>/dev/null; then
      dial="$fqdn"
      log_ok "MagicDNS: this Mac is $fqdn"
    else
      log_warn "MagicDNS name $fqdn does not resolve locally — using IP $ip"
    fi
  fi
  printf '%s' "$dial"
}

start_mock_relay() {
  local relay_py="$PHONEHANDS_DIR/mock-relay.py"
  cat > "$relay_py" <<'PYEOF'
import socket, threading, sys
src, dst = int(sys.argv[1]), int(sys.argv[2])
srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", src)); srv.listen(32)
def pipe(a, b):
    try:
        while True:
            d = a.recv(65536)
            if not d: break
            b.sendall(d)
    except OSError:
        pass
    finally:
        for s in (a, b):
            try: s.shutdown(socket.SHUT_RDWR)
            except OSError: pass
            s.close()
while True:
    c, _ = srv.accept()
    u = socket.create_connection(("127.0.0.1", dst))
    threading.Thread(target=pipe, args=(c, u), daemon=True).start()
    threading.Thread(target=pipe, args=(u, c), daemon=True).start()
PYEOF
  chmod 600 "$relay_py"
  start_bg "mock-relay" python3 "$relay_py" "$MOCK_TUNNEL_PORT" "$WDA_PORT"
}

case "$TUNNEL_MODE" in
  mock)
    start_mock_relay
    TUNNEL_ENDPOINT="127.0.0.1:$MOCK_TUNNEL_PORT"
    TUNNEL_REACHABLE_LOCAL=1
    log_ok "mock tunnel: $TUNNEL_ENDPOINT -> 127.0.0.1:$WDA_PORT"
    ;;
  headscale|auto)
    # DEFAULT: self-hosted headscale mesh. Falls back to the SSH leg.
    HS_URL="$(headscale_resolve_url)"
    if ! headscale_server_ready; then
      log_warn "headscale not found on your server."
      headscale_install_server "${PHONEHANDS_SSH_TUNNEL_HOST:-}" "$HS_URL"
    else
      log_ok "headscale server present."
    fi
    DIAL="$(headscale_join "$HS_URL")"
    HEADSCALE_URL_USED="$HS_URL"
    TUNNEL_ENDPOINT="$DIAL:$WDA_PORT"
    TUNNEL_REACHABLE_LOCAL=1
    TUNNEL_MODE="headscale"
    log_ok "headscale mesh: endpoint $TUNNEL_ENDPOINT (control plane: $HS_URL — yours)"
    ;;
  ssh)
    SSH_HOST="${PHONEHANDS_SSH_TUNNEL_HOST:-}"
    [ -n "$SSH_HOST" ] || die "SSH tunnel needs PHONEHANDS_SSH_TUNNEL_HOST (e.g. export PHONEHANDS_SSH_TUNNEL_HOST=user@relay.example.com). Key-based auth only."
    SSH_PORT="${PHONEHANDS_SSH_TUNNEL_PORT:-18100}"
    SSH_BIND="${PHONEHANDS_SSH_TUNNEL_BIND:-127.0.0.1}"
    log_info "self-hosted relay leg 2: SSH reverse tunnel"
    log_info "  $(redact "$SSH_HOST"):$SSH_BIND:$SSH_PORT -> 127.0.0.1:$WDA_PORT (key-based auth only)"
    if [ "$SSH_BIND" != "127.0.0.1" ] && [ "$SSH_BIND" != "localhost" ]; then
      log_warn "SSH tunnel bind $SSH_BIND is NOT loopback: WDA has no auth — anyone who can reach"
      log_warn "  $SSH_PORT on the server can control the phone. Prefer 127.0.0.1 + an authenticating proxy."
    fi
    # supervised tunnel: auto-reconnect ~5s after drop (loot 2026-10-10: 404jsh pattern —
    # one-shot `ssh -fN` never comes back on its own; dead peer detected via ServerAlive)
    start_bg "ssh-tunnel" env SSH_PORT="$SSH_PORT" SSH_BIND="$SSH_BIND" WDA_PORT="$WDA_PORT" SSH_HOST="$SSH_HOST" \
      bash -c 'while true; do ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=2 -o ConnectTimeout=10 -R "$SSH_BIND:$SSH_PORT:127.0.0.1:$WDA_PORT" "$SSH_HOST"; sleep 5; done'
    SSH_HOST_USED="$SSH_HOST"
    TUNNEL_ENDPOINT="${SSH_HOST##*@}:$SSH_PORT"
    TUNNEL_REACHABLE_LOCAL=0
    log_ok "ssh reverse tunnel open: endpoint $TUNNEL_ENDPOINT"
    log_warn "tunnel endpoint is NOT reachable from this Mac — verify from the remote side."
    [ "$SSH_BIND" = "127.0.0.1" ] && log_info "  bound to the server's loopback: reach it on the server itself, or via your authenticating proxy."
    ;;
  tailscale-official)
    log_warn "official Tailscale is the OPT-IN fallback (needs a third-party account)."
    if command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; then
      TS_IP="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
      if [ -n "$TS_IP" ]; then
        TUNNEL_ENDPOINT="$TS_IP:$WDA_PORT"
        TUNNEL_REACHABLE_LOCAL=1
        log_ok "official tailscale endpoint: $TUNNEL_ENDPOINT"
      fi
    fi
    [ -n "$TUNNEL_ENDPOINT" ] || die "official tailscale requested but not logged in. Run: tailscale up"
    ;;
esac

# ---------------------------------------------------------- relay URL + endpoint + healthcheck
# PHONEHANDS_RELAY_URL: the cross-platform relay convention.
RELAY_URL=""
case "$TUNNEL_MODE" in
  ssh)                RELAY_URL="ssh://${SSH_HOST_USED}:${SSH_PORT}" ;;
  headscale|auto)     RELAY_URL="ws://${TUNNEL_ENDPOINT}/" ;;
  tailscale-official) RELAY_URL="ws://${TUNNEL_ENDPOINT}/" ;;
  mock)               RELAY_URL="ws://${TUNNEL_ENDPOINT}/" ;;
esac
# headscale / tailscale-official / mock endpoints are directly dialable;
# ws:// here denotes the "direct" path class (WDA itself speaks plain HTTP
# on that TCP endpoint; Android uses real WebSocket on the same convention).

write_endpoint "$ENDPOINT_FILE" "$TUNNEL_ENDPOINT" "$TUNNEL_MODE" "$SSH_HOST_USED" "$WDA_PORT" "$RELAY_URL"
log_ok "endpoint file: $ENDPOINT_FILE (mode 600)"
if [ -n "$RELAY_URL" ]; then
  echo "  PHONEHANDS_RELAY_URL=$RELAY_URL"
  echo "  (operator side: export PHONEHANDS_RELAY_URL='$RELAY_URL')"
fi

echo; log_info "healthcheck — direct WDA"
PHONEHANDS_RELAY_URL="$RELAY_URL" "$SCRIPT_DIR/healthcheck.sh" --endpoint "127.0.0.1:$WDA_PORT" \
  || die "direct WDA healthcheck failed — see JSON above."

if [ "$TUNNEL_REACHABLE_LOCAL" = "1" ]; then
  echo; log_info "healthcheck — via tunnel endpoint"
  "$SCRIPT_DIR/healthcheck.sh" --endpoint-file "$ENDPOINT_FILE" \
    || die "tunnel healthcheck failed — the tunnel is up but WDA is not reachable through it."
else
  echo; log_info "remote-side verification command (run where the operator lives):"
  echo "  export PHONEHANDS_RELAY_URL='$RELAY_URL'"
  echo "  $SCRIPT_DIR/healthcheck.sh   # reads PHONEHANDS_RELAY_URL"
fi

echo; log_ok "setup complete."
echo "  Remote operation endpoint: $TUNNEL_ENDPOINT"
[ -n "$RELAY_URL" ] && echo "  PHONEHANDS_RELAY_URL:         $RELAY_URL"
[ -n "$HEADSCALE_URL_USED" ] && echo "  Headscale control plane:  $HEADSCALE_URL_USED (self-hosted)"
echo "  Endpoint file:             $ENDPOINT_FILE"
echo "  Tunnel mode:               $TUNNEL_MODE"
[ "$MOCK" = "1" ] && echo "  NOTE: mock run — brew/Xcode/signing steps marked MANUALLY-ON-MAC."
