# 22 · Recovery and parity regression suite

Status: resolved
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

### ADRs read and applied

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0046 | A late or duplicate payment never confirms the booking. | AC5. |
| 0072 | Consequential actions are versioned platform commands; duplicates are refused. | AC1 and AC2. |
| 0074 | An invalid surface keeps complete text and a conventional route. | AC4. |
| 0080 | Conventional routes execute the same command behaviour as chat. | AC6. |
| 0106 | A cold restore precedes every event; a model failure keeps state. | AC1 and AC3. |

### Code contradiction recorded

`/conversation` posts **guest messages** only. It renders the current surface as a link to the authoritative standard route; it has no `/conversation/event` command form. AC6's "no-JS `/conversation` post of the same commands" therefore cannot be exercised as written. The test proves the no-JS page offers the same standard route as the chat surface for the review command, and records that surface commands run on the standard route.

### Tests and commands

- `npm run check` — 0 errors.
- `npx tsx --test test/guest-recovery-regression.test.ts` — 6 tests, 6 passed, 0 failed.
- The suite reuses the existing cold-journey, restart and fallback helpers; no fixture is copied.

## Answer

The regression suite proves: a forged artifact is refused after a cold restore and the current state is shown; two tabs produce one effect; a model failure leaves the draft and facts intact; an invalid surface falls back to text and its standard route; a provider return never shows a confirmed reservation; and the no-JS page offers the same authoritative standard route as the chat. The `/conversation` command-post contradiction is recorded.
