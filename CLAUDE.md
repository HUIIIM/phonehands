# phonehands

PhoneHands: open-source tooling that connects dating-app APIs (Hinge MCP)
and iPhone device operation into one automation surface. Public, MIT.

## How work happens here

- Direction arrives in-repo: GitHub Issues labeled `jarvis-task`, PR
  review comments, and `CLAUDE.md` / `LOOP.md`. Read both at session start.
- External Claude works on `claude/*` branches and opens PRs; it never
  merges its own PRs. Jarvis reviews and merges.
- Review verdicts exist only as PR comments.

## Working rules

- License is MIT (changed from Business Source License 1.1 by owner
  ruling, 2026-10-31); do not reintroduce BSL terms anywhere.
- No credentials, session tokens, or personal account data in the repo —
  examples use placeholders only.
