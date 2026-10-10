# NOTICE — third-party code in @phonehands/device-backend

## ios-agent (MIT)

Device-backend is built on the architecture of
[emazaheri/ios-agent](https://github.com/emazaheri/ios-agent)
(public page claims MIT; full license text reproduced below;
license status **pending GC final ruling**).

### Adapted files (keep their MIT license header + this attribution)

| File in this package | Adapted from (ios-agent) |
|---|---|
| `src/wda/transport.ts` | `ios_mcp/wda/client.py` — low-level WDA HTTP client: request/response envelopes, WDA error vocabulary, timeouts |
| `src/wda/session.ts` | `ios_mcp/wda/session.py` — session lifecycle, snapshot tuning push, auto-heal |
| `src/wda/settings.ts` | `ios_mcp/config.py` (`SnapshotSettings`) + `ios_mcp/wda/session.py` (`_SETTINGS_KEYS`) — snapshot tuning values |
| `src/wda/errors.ts` | `ios_mcp/errors.py` + `ios_mcp/wda/client.py` (`_ERROR_MAP`) — typed error vocabulary |

### Patterns learned (implemented from scratch, no code copied)

- `src/device-adapter.ts` — the DeviceAdapter protocol idea from
  `ios_mcp/devices/base.py` ("everything platform-specific lives behind
  DeviceAdapter so upper layers never branch on device kind").
- `src/fallback.ts` — the scale-agreement check from
  `ios_mcp/perception/vision.py` (`_scale_for` / `_SCALE_TOLERANCE`):
  fail loudly on screenshot/logical-frame orientation disagreement
  instead of tapping the wrong place.
- `test/mock-server.ts` — the faked-WDA integration-test approach from
  `tests/fake_wda.py` (failure injection, call recording).

### Deliberate divergences (documented in code)

1. Timeouts map to `ActionTimeout` (not recoverable), mid-flight socket
   death to `ConnectionLost` (not recoverable). Upstream maps read
   timeouts to RunnerCrashed (recoverable → auto-heal retries). We do
   not: a timed-out mutating action is ambiguous and MV427 forbids
   replaying it.
2. Auto-heal replays only `SessionLost` and connection-refused
   `RunnerCrashed`, where the action provably never executed.
3. No `DeviceLocked` wake (out of MVP scope).

---

## MIT License text (from ios-agent, reproduced verbatim)

```
MIT License

Copyright (c) 2026 Ehsan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
