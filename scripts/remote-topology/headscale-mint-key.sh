#!/usr/bin/env bash
# SPDX-License-Identifier: BUSL-1.1
# Mint a reusable 24h pre-auth key for $1 — runs ON the headscale server
# (setup.sh pipes it over ssh). Prints ONLY the key on stdout.
# headscale >= 0.26: preauthkeys --user takes the numeric user ID, and keys
# look like hskey-auth-<prefix>-<secret> (legacy keys: a bare alnum string).
set -euo pipefail
user="$1"
# The CLI talks to headscale's root-owned unix socket.
hs() { if [ "$(id -u)" = 0 ]; then headscale "$@"; else sudo -n headscale "$@"; fi; }
hs users create "$user" >/dev/null 2>&1 || true
uid="$(hs users list --name "$user" -o json 2>/dev/null \
  | grep -Eo '"id": *"?[0-9]+' | grep -Eo '[0-9]+' | head -n 1)"
[ -n "$uid" ] || { echo "headscale-mint-key: no id for user $user" >&2; exit 1; }
hs preauthkeys create --user "$uid" --reusable --expiration 24h 2>/dev/null \
  | grep -Eo 'hskey-auth-[A-Za-z0-9]+-[A-Za-z0-9]+|[A-Za-z0-9]{20,}' | head -n 1
