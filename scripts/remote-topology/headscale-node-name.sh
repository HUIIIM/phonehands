#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Read `headscale nodes list -o json` on stdin; print the MagicDNS name
# (given_name) of the node whose hostname/name matches $1. Prints nothing if
# absent. Used by setup.sh on the Mac; the human-readable table is colored and
# pipe-separated, so it must not be parsed with awk.
set -euo pipefail
python3 -c '
import json, sys
want = sys.argv[1].lower()
try:
    nodes = json.load(sys.stdin) or []
except ValueError:
    sys.exit(0)
for n in nodes:
    names = [str(n.get(k, "")) for k in ("given_name", "givenName", "name")]
    if any(want == x.lower() or want in x.lower() for x in names if x):
        print(n.get("given_name") or n.get("givenName") or n.get("name"))
        break
' "$1"
