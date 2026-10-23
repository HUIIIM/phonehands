# phonehands Android wire protocol (MVP)

<!-- SPDX-License-Identifier: BUSL-1.1 -->

Phone → agent: the **phone dials out**. No port forwarding, no same-LAN
requirement, no USB. The relay URL is shared by convention:

- agent side reads `PHONEHANDS_RELAY_URL` (see `@phonehands/android-backend`)
- phone side types it once in the setup UI (persisted in SharedPreferences)

```
ws(s)://host:port/phonehands-android
```

Transport: one WebSocket per phone. All messages are JSON text frames.

---

## Downlink — agent → phone

### action

```json
{ "type": "action", "id": "<uuid>", "action": "tap", "params": { "x": 540, "y": 1200 } }
```

| action     | params                                                  |
|------------|---------------------------------------------------------|
| `tap`      | `{ "x": <px>, "y": <px> }` — absolute screen pixels     |
| `swipe`    | `{ "x1":..,"y1":..,"x2":..,"y2":.., "duration_ms": 300 }` |
| `screenshot` | `{}` — returns the latest streamed frame                |
| `launch`   | `{ "package": "com.example.app" }`                      |
| `observe`  | `{}` — returns the accessibility tree                   |

> MVP has **no `type` action** — text input arrives in Phase 2.
> Auth screens (password / OTP / biometrics) are pause/resume: the phone
> never receives credentials over the wire, the human completes them.

### ping

```json
{ "type": "ping", "id": "<uuid>" }
```

---

## Uplink — phone → agent

### hello (first message after connect)

```json
{
  "type": "hello",
  "device_id": "<stable uuid, survives reconnects>",
  "platform": "android",
  "model": "Google Pixel 8",
  "width": 1080, "height": 2400, "density_dpi": 420,
  "capabilities": ["tap", "swipe", "screenshot", "launch", "observe"],
  "token": "<relay auth token, or empty>"
}
```

Server behavior: token mismatch → close 4403. Same `device_id`
reconnecting replaces the old socket (dedup, no double counting).

### ack (one per action, matched by `id`)

```json
{ "type": "ack", "id": "<action id>", "ok": true, "latency_ms": 87,
  "error": null, "data": null }
```

`data` by action:

- `tap` / `swipe` / `launch` → `null`
- `screenshot` → `{ "jpeg_b64": "...", "width": 360, "height": 780, "frame_age_ms": 123 }`
- `observe` → `{ "nodes": [ { "class": "android.widget.Button", "text": "OK",
  "content_desc": "", "bounds": [l,t,r,b], "clickable": true }, ... ],
  "truncated": false }` (capped at 500 nodes)

Failure: `"ok": false, "error": "<short reason>"`. No retries of
uncertain mutating actions — a gesture that times out is reported as
failed; the agent re-observes before deciding (MV427: never replay
uncertain input).

### frame (streamed, ~1 fps)

```json
{ "type": "frame", "seq": 12, "ts": 1760049600000,
  "width": 360, "height": 780, "format": "jpeg", "jpeg_b64": "..." }
```

Downscaled 360 px wide, JPEG q55, base64 in a JSON frame. Simple to parse
everywhere (including the Node mock); the ~33% base64 overhead is accepted
for MVP. Binary framing is a Phase 2 optimization.

### pong

```json
{ "type": "pong", "id": "<ping id>" }
```

---

## Keepalive / reconnect

- Agent sends `ping` every 30 s; phone answers `pong`.
- Missed pongs / socket close → phone reconnects with exponential backoff
  (2 s → 60 s cap), same `device_id`.
- The server drops sockets idle > 90 s (no hello, no pong, no frame).

## Relay auth

Optional shared token (`PHONEHANDS_RELAY_TOKEN` on the agent side, typed once
in the phone setup UI). Sent inside `hello`, never in the URL, **never
logged** — server logs only presence/absence. Mismatch → socket closed.

## Coordinate system

All gesture coordinates are **absolute pixels** in the phone's current
orientation, taken from the `hello` width/height. The agent converts from
frame pixels (360 px stream) to device pixels using the hello dimensions.
