<!-- SPDX-License-Identifier: BUSL-1.1 (pending GC final review) -->

# @phonehands/hinge-adapter

Hinge app adapter (MVP: **read-only**) for the phonehands API engine.

Reads (`likes_received` / `matches` / `chat_messages`) go through the API
engine and return structured JSON in the core envelope
`{ ok, backend: "api", latency_ms, degraded, evidence }`.
Writes do not exist in Phase 1.

**Test redline:** every test runs against the bundled mock Hinge server on
`http://127.0.0.1` (ephemeral port). Tests never touch the real Hinge API
and never use a real account. The adapter constructor requires an explicit
`baseUrl` -- there is deliberately no production default.

## Usage

```ts
import { HingeApiAdapter, startMockHingeServer } from "@phonehands/hinge-adapter";

// In tests / local dev: point at the mock server.
const mock = await startMockHingeServer();
const hinge = new HingeApiAdapter({
  baseUrl: mock.url, // REQUIRED; production host is never the default
  locale: { language: "en-US", region: "US" }, // REQUIRED, parameterized
});

// Interactive login: OTP comes from a secure no-echo TTY prompt,
// never from function arguments, CLI flags, logs, or disk.
await hinge.loginInteractive("+15551234567");

const likes = await hinge.likes_received({ limit: 20 });
if (likes.ok) {
  console.log(likes.evidence.items.length, "likes", "degraded:", likes.degraded);
}

const matches = await hinge.read("matches", { limit: 20, cursor: null });
const messages = await hinge.read("chat_messages", { chatId: "chat-1", limit: 20 });

await hinge.logout();
await mock.close();
```

Programmatic (non-interactive) login is available via `hinge.auth`
(`LoginStateMachine`: `install()` -> `initiate()` -> `submitOtp()` ->
persist; 412 -> `EmailChallengeRequired` -> `submitEmailChallenge()`).

## Capability table (for the core Router)

`HINGE_CAPABILITIES` / `hinge.capabilities()` declares:

| action            | supported | reason                                    |
|-------------------|-----------|-------------------------------------------|
| read              | yes       | API engine: millisecond structured reads  |
| likes_received    | yes       |                                           |
| matches           | yes       |                                           |
| chat_messages     | yes       |                                           |
| tap / swipe / ... | no        | compile-time read-only; writes = device   |

## Security

**1. Compile-time read-only (api-backend).** The API engine package exports
no write methods at all -- there is nothing to disable or bypass.

**2. Default-deny write allowlist (T2 mode).** If write tools are ever added
(Phase 2), they are NOT registered by default. Only names explicitly listed
in `HINGE_ALLOWED_WRITE_TOOLS` (comma-separated) become callable:

```sh
HINGE_ALLOWED_WRITE_TOOLS="send_message" node my-script.js
```

Unknown names (including typos) stay denied; the Phase 1 registry is
intentionally empty, so the allowlist currently enables nothing.
Pattern learned from T2 (vanxh/instagram-personal-mcp) -- mode only, no code
copied; T2 license compatibility is pending GC ruling.

**3. Secrets via secure TTY prompt (T2 mode).** `loginInteractive()` reads
OTP/verification codes with echo disabled (getpass idea). The secret never
appears in the output stream, never in logs, never as a CLI/chat/function
argument, and is never persisted. Without a TTY on stdin AND stdout the
prompt refuses to run instead of falling back to echo.

**4. Session file hardening.** `~/.phonehands/hinge.session.json` is created
`0600` (dir `0700`), written atomically (temp + fsync + rename), validated
with zod on load -- and **loading is refused outright if group/other have
any permission bits** (stricter than creation-time 0600). A corrupt session
fails loudly and forces re-login; it is never silently repaired.

**5. Self-throttling.** Every request goes through one serial queue with a
minimum interval (default 800 ms) and exponential backoff with jitter on
429/5xx, honoring `Retry-After`. Three consecutive failures mark the backend
`degraded` so the core Router can fall back to the device engine.

**6. Secret hygiene.** `redact()` / `sanitizeLogLine()` strip token-shaped
values from structured output and log lines; tests feed fake secrets and
assert zero residue.

## Tests

```sh
npm test   # node --test, all suites run against the mock server
```

Suites: `mock-server` (endpoints + 412 + fault injection), `hinge-adapter`
(3 reads, pagination, `read()` dispatch, 403/429 resilience, write refusal),
`secure-prompt` (no-echo proof, TTY refusal), `write-allowlist`
(default deny, env parsing).

## License

`SPDX-License-Identifier: BUSL-1.1 (pending GC final review)` on every
source file. Never MIT. Final legal text to be determined by GC.
