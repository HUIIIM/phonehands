# @phonehands/core

Unified Action interface + Router + result envelope + serial operation queue
+ auth handoff. The contract every PhoneHands package implements.

Actions: `observe / tap / tap_text / swipe / type_text / read / launch_app / press_home / screenshot`.

Every result returns the envelope:

```ts
{ ok, backend: "api" | "device", latency_ms, degraded, evidence,
  escalated, devicePlatform /* required iff backend === "device" */ }
```

## What's inside

| Module | What it does |
|---|---|
| `src/actions.ts` | Frozen `PhoneAction` interface, action names, privilege tiers |
| `src/types.ts` | Envelope + `devicePlatform` contract validation |
| `src/backend.ts` | `Backend` interface + capability-table helpers |
| `src/registry.ts` | Action/backend registry; write actions absent in read-only builds |
| `src/router.ts` | Capability-table routing, API degrade/recover, no-silent-escalation, `emergencyStop()` stub |
| `src/queue.ts` | Per-account serial queue (32 cap, per-op deadline, unknown-state timeout) |
| `src/auth-handoff.ts` | AUTH_REQUIRED → PAUSED → RESUMED / ABANDONED state machine |
| `src/audit.ts` | Audit log with secret redaction |
| `src/errors.ts` | Typed errors (`NO_CAPABLE_BACKEND`, `TIMEOUT_UNKNOWN`, `abandoned:auth_timeout`, …) |

## Build & test

```bash
npm run build          # tsc (strict); bakes PHONEHANDS_READ_ONLY into the artifact
npm test               # build + node:test (44 tests)
npm run test:coverage  # c8, gate: lines >= 80%
npm run test:readonly  # PHONEHANDS_READ_ONLY=1 build + read-only assertions (5 tests)
```

Read-only is a **compile-time** switch: with `PHONEHANDS_READ_ONLY=1`,
write actions (`tap / tap_text / swipe / type_text`) are never registered —
importing them throws. Not a runtime flag.

## Design claims → evidence

| README claim | Evidence |
|---|---|
| reads → API, writes → device | `test/router.test.js`: "read-tier actions go to the api backend", ios/android routing tests |
| 3× 4xx/timeout → degraded, 5× probes → recover | fault-injection tests (403 / TIMEOUT throw / empty response) |
| AUTH_REQUIRED never degrades the API engine | "does not count toward degrade; pauses the account queue" |
| no silent escalation | `NO_CAPABLE_BACKEND` test + `allowEscalation`/`escalated:true` test |
| queue: 32 cap, 30s deadline, timeout = unknown, no auto-replay | `test/queue.test.js` (incl. exactly-once invocation count) |
| credentials never in logs | fake-password test in `test/auth-handoff.test.js` + `redactSecrets` tests |
| loopback-only posture (core is transport-free) | `test/security.test.js`: no network imports in `src/` |
| BSL-1.1 headers, no MIT | `test/security.test.js` header scan |

License: `SPDX-License-Identifier: BUSL-1.1 (pending GC final review)`. Never MIT.
