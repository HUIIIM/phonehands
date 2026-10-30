#!/usr/bin/env bash
# SPDX-License-Identifier: BUSL-1.1
# headscale server install — runs ON the user's Linux server (setup.sh pipes it
# over ssh: `ssh host bash -s URL PORT VER SHA < headscale-server-install.sh`).
# Kept as its own file so CI can run exactly this code on a real Linux host.
#   $1 server_url  $2 listen port  $3 pinned version  $4 sha256 ("" = built-in pin)
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
  # Schema matches the pinned release's config-example.yaml (0.23+ keys:
  # noise.private_key_path, dns.*); the noise key is generated on first start.
  sudo tee /etc/headscale/config.yaml >/dev/null <<YAML
server_url: ${SERVER_URL}
listen_addr: 0.0.0.0:${SRV_PORT}
noise:
  private_key_path: /var/lib/headscale/noise_private.key
prefixes:
  v4: 100.64.0.0/10
  v6: fd7a:115c:a1e0::/48
derp:
  server:
    enabled: false
  urls: []
  paths: []
  auto_update_enabled: false
database:
  type: sqlite
  sqlite:
    path: /var/lib/headscale/db.sqlite
dns:
  magic_dns: true
  base_domain: phonehands.tailnet
  override_local_dns: false
  nameservers:
    global:
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
RuntimeDirectory=headscale
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
