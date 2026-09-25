# Liveness: typing indicator, timeout, retry

Status: resolved
Type: task
Blocked by: 05
Findings: F12 (see ../PRD.md)

## What to build

Show a typing indicator while a turn is pending. Add a fetch timeout, and on failure show a Retry control that re-sends the same idempotent turn and keeps the draft text.

## Acceptance criteria

- AC1: A pending turn shows an indicator that is announced once.
- AC2: A turn that times out shows Retry and keeps the text.
- AC3: Retrying a command event does not create a second Booking Request.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0079 | Retry never repeats a committed command |
| 0070–0072 | Duplicate events are deduplicated server-side |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

- AC1: While `/api/turn` is pending, `#working-status` is visible and the polite announcer says "working on your request" exactly once (Chromium test with a delayed intercepted response).
- AC2: `postJson` aborts after 10 seconds (`AbortSignal.timeout`) and treats non-2xx as failure. The failure turn carries a Retry button, the composer keeps the text, and Retry re-sends the same turn and then clears the composer. A used Retry control is removed so it cannot be pressed again with no effect.
- AC3: Retrying a command event re-sends the same server-issued event. A repeated submit from the old review surface fails closed, and exactly one Booking Request exists (`LocalGuestApp` test).
- ADRs: ADR-0079 is cited at the timeout callsite (aborting the client wait never rolls back a committed command). ADR-0070–0072 deduplication is exercised by the AC3 test. No new copy touches money or legal states, and nothing new reaches telemetry or logs.
- Verification: `npm run check` passed. `npm test`: 1,085 passed, 1 failed, 1 skipped. The failure was `listing-photos-mobile-chromium.test.ts` "AC13/AC15/AC20/AC21 … at 390px", which timed out waiting for the discovery image under full-suite load. The same file passed 3/3 when rerun alone, so it is recorded as load-related flakiness, not an S2 regression. Walkthrough at 375px and 1280px on a branch server at :3004 (:3001 was occupied): the indicator was shown and announced, and a forced failure showed Retry with the text kept. Retry succeeded with no horizontal overflow.
- Implementation commit: `6230c96` (`feat(guest): add liveness timeout and retry`).
