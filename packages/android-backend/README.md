# @phonehands/android-backend

<!-- SPDX-License-Identifier: BUSL-1.1 -->

Wireless-first Android device engine for PhoneHands. The phone dials **out**
to the agent's WebSocket relay — NAT-safe, no USB, no same-LAN requirement,
no port forwarding. This is the "true wireless" iOS cannot do.

## Quick start (mock)

```bash
npm test          # c8 coverage gate (>=80% lines) + node:test
npm run build     # tsc -> dist
```

```bash
# Terminal 1: run the end-to-end demo (mock phone)
cd ../../examples/android-wireless-demo
node demo.ts
# ... ends with: {"relay":"ws://127.0.0.1:9011/phonehands-android",
#                 "reachable":true,"latency_ms":11,"path":"direct"}
```

## Relay convention

One environment variable, shared by phone and agent:

```bash
export PHONEHANDS_RELAY_URL="ws://127.0.0.1:9011/phonehands-android"
# (old name DUALTAP_RELAY_URL is deprecated — see docs/android-deploy.md)
```

| Variable               | Meaning                                              |
|------------------------|------------------------------------------------------|
| `PHONEHANDS_RELAY_URL` | `ws(s)://host:port/path` the phone dials             |
| `PHONEHANDS_RELAY_PATH`| override healthcheck path: `direct\|ssh-tunnel\|tailscale` |

The server binds `127.0.0.1:<port>` by default. For remote operation put it
behind an SSH reverse tunnel or Tailscale — never expose 9011 to the public
internet directly.

## API

```ts
import {
  AndroidRelayServer,   // agent-side WebSocket server
  AndroidDevice,        // per-phone actions -> PhoneHands envelope
  checkRelay,           // { relay, reachable, latency_ms, path }
  MockAndroidDevice,    // protocol-faithful test double (no real phone)
  relayUrlFromEnv, parseRelayUrl,
  canHandle, capabilityFor, ANDROID_CAPABILITIES,
} from "@phonehands/android-backend";

const server = new AndroidRelayServer({ port: 9011, authToken: "secret" });
await server.start();
server.onDevice = (info) => console.log("phone online:", info.deviceId);

const device = new AndroidDevice(server, server.listDevices()[0]);
await device.tap(180, 390);        // frame pixels, scaled to device px
await device.swipe(180, 600, 180, 200);
await device.screenshot();         // -> { jpeg_bytes: Buffer, ... }
await device.observe();            // -> { nodes: [...], truncated }
await device.launch("com.example.app");
```

Every action returns the PhoneHands envelope:

```ts
{ ok, backend: "device", devicePlatform: "android",
  latency_ms, degraded, evidence }
```

## Capabilities (MVP)

`tap`, `swipe`, `screenshot`, `launch`, `observe`.
`type` (text input) is Phase 2 — `capabilityFor("type")` returns `null`
(fail closed) so the Router picks another backend.

## Safety rules baked in

- A gesture that times out is `evidence.uncertain: true` — **never
  auto-replayed** (re-observe first).
- The relay token travels in `hello.token`, never in the URL, never in logs
  (asserted by test).
- Auth screens are pause/resume: the phone never receives credentials.
- Fallback: `src/wireless-adb.ts` documents the wireless-ADB command shapes
  (hook only — the WebSocket APK is the primary path).

## Layout

| Path              | Contents                                      |
|-------------------|-----------------------------------------------|
| `src/server.ts`   | `AndroidRelayServer`: hello/auth/dedupe/frames/keepalive |
| `src/device.ts`   | `AndroidDevice`: actions -> envelope          |
| `src/protocol.ts` | pure JSON codecs + `describeMessage` (secret-free logs) |
| `src/relay-url.ts`| `PHONEHANDS_RELAY_URL` parsing                |
| `src/healthcheck.ts` | unified `{ relay, reachable, latency_ms, path }` |
| `src/mock-device.ts` | mock phone for tests/demo                   |
| `src/wireless-adb.ts` | documented fallback command builder        |
| `src/capabilities.ts` | Router capability table                    |
| `tests/`          | 32 tests incl. mock WebSocket e2e + fault injection |

Wire protocol: `../android-helper/PROTOCOL.md`.
Deploy guide (Chinese): `../../docs/android-deploy.md`.
