<!-- SPDX-License-Identifier: BUSL-1.1 (pending GC final review) -->

# @phonehands/api-backend

The fast engine: a reverse-engineered mobile HTTP client that impersonates
the official app, with a login state machine, hardened session storage,
built-in self-throttling, and secret hygiene.

Clean-room implementation of the patterns (phone impersonation, login
state machine, session safety quartet, self-throttling): ideas learned,
no code copied.

## Modules

| module                | responsibility                                                              |
|-----------------------|-----------------------------------------------------------------------------|
| `fingerprint.ts`      | phone impersonation: UA fingerprint + device triple (re-randomized per login) + business headers; **locale (language/region) is required and parameterized, never hardcoded** |
| `http-client.ts`      | self-throttling HTTP: single serial queue, min request interval, exponential backoff with jitter on 429/5xx honoring `Retry-After`, bounded retries, degraded-health probe |
| `login-state-machine.ts` | `install -> initiate -> submit -> token persistence`; HTTP 412 becomes a first-class `EmailChallengeRequired` (email fallback channel); re-login is destructive; logout rotates device identity |
| `session-store.ts`    | `session.json`: 0600 file / 0700 dir, atomic write (temp + fsync + rename), path-traversal guard, zod validation on load; **refuses to load when group/other have any permission bits** |
| `redact.ts`           | recursive secret redaction for structured output + log-line sanitizer       |
| `capabilities.ts`     | capability table for the core Router (`read`/`likes_received`/`matches`/`chat_messages` supported; all writes unsupported -- **compile-time read-only**) |

Adapters wrap every result in the core envelope
`{ ok, backend: "api", latency_ms, degraded, evidence }` (see
`@phonehands/hinge-adapter`, whose tests assert the envelope shape on every
read path).

## Tests

```sh
npm test   # node --test: 30+ tests, all network tests against localhost servers
npm run build  # tsc typecheck (strict + erasableSyntaxOnly)
```

Suites: `fingerprint` (locale parameterization, triple re-randomization),
`session-store` (0600/atomic/zod/strict-perm gate), `http-client`
(interval, 429 backoff + Retry-After, retry budget, 403 no-retry, degraded
probe, log redaction), `login-state-machine` (full flow, 412 first-class,
destructive re-login, logout rotation), `capabilities` + `redact`.

## License

`SPDX-License-Identifier: BUSL-1.1 (pending GC final review)` on every
source file. Never MIT. Final legal text to be determined by GC.
