# @phonehands/device-backend

Device engine for PhoneHands: USB → WebDriverAgent link. Real taps,
indistinguishable from a human in the app's eyes.

Base: [emazaheri/ios-agent](https://github.com/emazaheri/ios-agent)
(MIT; see `NOTICE.md`) — WDA typed client architecture, DeviceAdapter
protocol idea, snapshot tuning, auto-heal, per-frame pixel scaling.
PhoneHands redlines (loopback-only, degrade chain,
never-replay-uncertain, redacted audit) live in
`src/device-backend.ts` and are never bypassed.

## Architecture

```text
transport (HTTP, WDA error vocabulary, timeouts)
  → session (lifecycle, snapshot tuning, auto-heal)
    → backend (envelope, degrade chain, loopback guard, audit)
```

Upper layers program against the `DeviceAdapter` protocol and never
branch on device kind; the Router picks backends by the capability
table in `src/capabilities.ts` (`tap` / `swipe` / `type` / `observe` /
`screenshot`).

Every action returns the core envelope:
`{ ok, backend: "device", latency_ms, degraded, evidence }`.

## The three adopted mechanisms

1. **Snapshot tuning** (`src/wda/settings.ts`): WDA's default
   accessibility trees are too large/slow for an agent loop. On every
   new *and* every recovered session we push `snapshotMaxDepth: 50`,
   `snapshotMaxChildren: 64`, `customSnapshotTimeout: 5.0`,
   `waitForIdleTimeout: 2.0`, `useFirstMatch: true` via
   `POST /appium/settings` (values measured on a physical iPhone).
   Sessions are opened *unbound* (no `bundleId` in capabilities) with
   `shouldTerminateApp: false`, so `/source` follows the foreground app.
2. **Auto-heal** (`src/wda/session.ts`): a dead session
   (`invalid session id`) or a dead runner (connection refused) is
   healed once — new session, tuning re-applied, foreground app
   restored — and the envelope reports `recovered: true` instead of
   throwing. Heals and retries **only** when the action provably never
   executed. Timeouts and mid-flight disconnects are ambiguous: they
   return `ok: false` + `uncertain: true` and are **never** replayed
   (deliberate divergence from upstream, the no-auto-replay rule).
3. **Per-frame pixel scaling** (`src/fallback.ts`): the screenshot→tap
   mapping reads a fresh `/window/size` every frame (never a cached
   ratio) and requires the two axes to agree within 2% — otherwise it
   throws `OrientationMismatchError` instead of tapping the wrong place.

## Degrade chain (caller flow — tree fail → screenshot → pixel map → tap)

1. Call `observe()`. Tree-first: a usable accessibility tree returns
   `ok: true, degraded: false`. (A tree holding only the application
   root counts as empty — the hollow-tree case.)
2. If the tree is empty / malformed / unreachable, `observe()` falls
   back to a screenshot and returns `ok: true, degraded: true` with
   `evidence.tree_unavailable = true`. The backend NEVER blind-retries;
   it makes exactly one attempt per step.
3. The caller (Router / model vision / human operator) owns pixel
   locating: it produces a **normalized box** `{ x, y, width, height }`
   in 0..1 relative to the screenshot pixels.
4. Convert with `backend.mapScreenshotBox(screenshot, box,
   orientation)` — reads fresh logical geometry per frame, un-rotates
   landscape screenshots to the portrait frame first (derivation in
   `src/fallback.ts`), returns `{ x, y }` in WDA tap coordinates.
5. `backend.tap(x, y)` — a single attempt. On timeout/disconnect it
   returns `ok: false` with `evidence.uncertain = true`; the Router
   decides what to do next.

## Tests

All tests run against `test/mock-server.ts` (a faked WDA on 127.0.0.1
with an ephemeral port, failure injection included). **No real device
is ever touched.**

```sh
npm run build   # tsc, strict
npm test        # node:test over dist/test/*.test.js
npx c8 --reporter=text --check-coverage --lines 80 \
  --exclude='dist/test/**' node --test 'dist/test/*.test.js'
```

Current: 47 tests, 0 failures, 90.93% line coverage (gate: ≥ 80%).

## License

This package mixes two license regimes — see `NOTICE.md`:

- `src/wda/*`: adapted from ios-agent, **MIT** headers retained.
- Everything else: `SPDX-License-Identifier: BUSL-1.1` — never MIT.
