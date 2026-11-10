# 22 · Recovery and parity regression suite

Status: ready-for-agent
Type: task
Blocked by: 11
Phase: 3 (Batch C)
Applicable ADRs: 0072, 0074, 0080, 0106, 0046; guideline §14 release invariants

## What to build

Extend `test/assistant-cold-journey.test.ts`, or a sibling test that uses the same helpers (no copied fixtures), to prove the release invariants: no false payment confirmation, no unauthorised command, no unrecoverable draft loss.

- Stale, superseded and expired actions after a cold restore.
- Cross-tab double action (single effect).
- Model timeout keeps the last authoritative state.
- An invalid generated surface falls back to complete text plus its standard route.
- Provider return without verification shows not-confirmed.
- A no-JS `/conversation` post of the same commands gives the same outcome.

## Acceptance criteria

1. A stale, superseded or expired action is refused after a cold restore, and the current state is shown
2. The same action from two tabs takes effect once
3. A model timeout leaves the previous facts visible and the draft intact
4. An invalid generated surface renders its text fallback and standard route
5. Provider return without verified payment never shows a confirmed reservation
6. The no-JS route gives the same command outcome as chat for submit and accept

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- Assistant path: read ADR 0106 in full first. Tests run with the assistant runtime enabled and a cold restore (a new `LocalGuestApp` over the same store) before every event, on a fresh thread, with a staging-like clock (2026-10-27) and guest. `test/assistant-cold-journey.test.ts` is the model.

## Comments
