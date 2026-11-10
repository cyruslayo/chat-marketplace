# 21 · Cancel a long assistant turn

Status: ready-for-agent
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
