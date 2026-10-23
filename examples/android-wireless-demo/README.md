# android-wireless-demo

<!-- SPDX-License-Identifier: BUSL-1.1 -->

End-to-end MVP proof for the Android wireless backend — **mock phone only**,
no real device touched.

```bash
node demo.ts
```

Flow:

1. Start `AndroidRelayServer` on `PHONEHANDS_RELAY_URL`
   (default `ws://127.0.0.1:9011/phonehands-android`).
2. Connect `MockAndroidDevice`, wait for hello + first streamed frame.
3. `tap` → `screenshot` → `observe` → `launch`, asserting every envelope.
4. Print the unified healthcheck JSON and exit 0.

Expected tail output:

```text
[demo] tap ok, latency_ms = 0
[demo] screenshot ok, bytes = 240
[demo] observe ok, nodes = 2
[demo] launch ok
{"relay":"ws://127.0.0.1:9011/phonehands-android","reachable":true,"latency_ms":11,"path":"direct"}
[demo] ALL ASSERTIONS PASSED
```

Typecheck: `npx tsc --noEmit -p tsconfig.json`.
