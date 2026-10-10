<!-- SPDX-License-Identifier: BUSL-1.1 (pending GC final review) -->
---
name: hinge
description: Read-only access to Hinge dating data (likes received, matches, chat messages) through the phonehands API engine. Use when the agent needs to READ Hinge data fast as structured JSON. Do NOT use for any write (like/skip/send message), for Google/Apple SSO login, or for OTP-walled flows -- those go to the device engine. Only ever operates on the user's own account.
---

# Hinge skill (phonehands)

## When to use the API engine

Use this skill (the API engine) when the task is a **read**:

- `likes_received` -- who liked the user
- `matches` -- match list (paginated)
- `chat_messages` -- messages in one chat

Reads return in milliseconds as structured JSON inside the core envelope:

```ts
{ ok: true, backend: "api", latency_ms: 42, degraded: false,
  evidence: { items: [...], nextCursor: "20" } }
```

`degraded: true` means the call only succeeded after retry/backoff, or the
engine health probe has marked the API degraded -- treat results as
best-effort and consider switching engines.

```ts
import { HingeApiAdapter, startMockHingeServer } from "@phonehands/hinge-adapter";

// Local dev / tests: ALWAYS the mock server first.
const mock = await startMockHingeServer();
const hinge = new HingeApiAdapter({
  baseUrl: mock.url, // REQUIRED -- never defaults to production
  locale: { language: "en-US", region: "US" }, // REQUIRED -- never hardcoded
});
await hinge.loginInteractive("+15551234567"); // OTP via secure TTY prompt
const likes = await hinge.read("likes_received", { limit: 20 });
```

## When to switch to the device engine

Route to the **device engine** (real taps via WebDriverAgent) when:

- the action is a **write**: like, skip, send_message, update_preferences --
  the API engine is compile-time read-only and refuses all writes;
- login needs **Google/Apple SSO** -- the API engine only implements the
  SMS + email-challenge paths;
- an **SMS OTP wall** appears that the API cannot cross -- the device engine
  reads the code from the SMS app on the real phone;
- the API engine reports `degraded: true` persistently (403s, endpoint
  changes) -- the device engine sees UI, not endpoints, and keeps going.

Rule of thumb: **reads go through the API (fast), writes go through the
device (human-like). When the API dies, the device takes over.**

## Risk redlines (non-negotiable)

1. **Reads first.** Never perform a write the user did not explicitly ask for.
2. **Own account only.** This skill operates on the user's own Hinge account.
   No third-party accounts, no bulk operations.
3. **Audit everything.** Every action is logged (sanitized -- secrets never
   land in logs). One-key disconnect: `hinge.logout()` drops tokens and
   rotates device identity.
4. **Locale is parameterized.** Region/language come from configuration.
   Hardcoding them (the IN/en-GB anti-pattern) is forbidden.
5. **Test double discipline.** Development and tests run against the mock
   server on `127.0.0.1` only. Touching the production host requires an
   explicit `baseUrl` and a logged-in session -- never by accident.
6. **ToS honesty.** This client impersonates the official app's network
   fingerprint. Review Hinge's terms before use; the README states the
   gray-area posture on its first screen.

## Capability reference

| action         | engine | supported |
|----------------|--------|-----------|
| likes_received | api    | yes       |
| matches        | api    | yes       |
| chat_messages  | api    | yes       |
| like / skip / send_message | api | **no** -- device engine (Phase 2) |

## License note

phonehands is BSL 1.1 direction (source public, non-production free,
production/commercial use requires our authorization; converts to Apache 2.0
after 4 years). Final legal text pending GC review -- do not treat this
skill's summary as the license.
