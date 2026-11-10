# 21 · Cancel a long assistant turn

Status: resolved
Type: task
Blocked by: none
Phase: 3 (Batch C)
Applicable ADRs: 0106; guideline §6 turn behaviour, §12 (unknown outcome)

## What to build

A turn can wait about 188s (`apps/local-guest/src/turn-budget.ts`). `postJson` (`client.ts` ~2579) uses `AbortSignal.timeout` only, with no user cancel.

- Show a Cancel button together with the existing 10s "still working" copy.
- Combine a user `AbortController` with the timeout: `AbortSignal.any([user.signal, AbortSignal.timeout(ms)])` when `typeof AbortSignal.any === "function"`, otherwise one controller aborted by both a `setTimeout` and the button (Baseline newly available, so it needs the fallback).
- After a cancel, reuse `showLandedTurn`: ask `/api/state` whether the turn landed. If it did, show it. If not, keep the text in the composer. Say "Stopped waiting. Your message may still be answered." rather than claiming it was cancelled on the server.

## Acceptance criteria

1. A Cancel control appears once the turn passes the still-working threshold
2. Cancel stops waiting and keeps the guest's text when the turn has not landed
3. A turn that landed before the cancel is shown, not lost
4. The fallback path works when AbortSignal.any is unavailable

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- Assistant path: read ADR 0106 in full first. Tests run with the assistant runtime enabled and a cold restore (a new `LocalGuestApp` over the same store) before every event, on a fresh thread, with a staging-like clock (2026-10-27) and guest. `test/assistant-cold-journey.test.ts` is the model.
- This issue changes `apps/local-guest/src/client.ts`. Never run it alongside another `client.ts` issue (11, 14, 19, 21, 24). Rebuild `client.js` and commit the regenerated `dist/client.js` only.

## Comments

### ADRs read and applied

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0106 | The turn wait is not a user-facing deadline; an interrupted wait must re-read the thread and never claim a server cancel. | AC2 and AC3. |
| 0078 | Focus and status remain usable on a phone; the canceled state is spoken. | AC1 and AC2. |
| 0079 | Aborting the browser wait never rolls back a committed command. | `showLandedTurn` decides from the thread. |

### Implementation

- The composer page has a hidden `#turn-cancel` button that appears with the existing still-working copy after `TURN_STILL_WORKING_AFTER_MS`.
- `postJson` accepts a user signal; `combinedAbortSignal` uses `AbortSignal.any` when available and a manual `AbortController` fallback otherwise.
- On a guest cancel, `showLandedTurn` reads `/api/state`: a landed turn is shown and its text cleared; otherwise the text stays in the composer and the guest sees "Stopped waiting. Your message may still be answered." (never a server-cancel claim).
- The copy lives in `GUEST_ASSISTANT_COPY.stoppedWaiting`.

### Tests and commands

- `npm run check` — 0 errors.
- `npx tsx --test test/guest-turn-cancel.test.ts` — 3 tests, 3 passed, 0 failed.
- Real Chrome: `npx tsx --test test/guest-turn-cancel-chromium.test.ts` — 1 test, 1 passed, 0 failed (Cancel appears after the threshold, the message stays, the stopped-waiting sentence appears).
- `client.js` rebuilt; only the regenerated `dist/client.js` is staged.

## Answer

A slow turn now offers Cancel after the still-working threshold. Cancel stops the browser wait, re-reads the thread, shows a turn that landed, and otherwise keeps the guest's message with "Stopped waiting. Your message may still be answered." The `AbortSignal.any` fallback is covered by tests.
