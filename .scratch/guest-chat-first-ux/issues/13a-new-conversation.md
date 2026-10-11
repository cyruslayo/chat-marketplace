# New conversation without losing committed work

Status: resolved
Type: task
Blocked by: 09
Parent: [13](13-thread-control.md)

## What to build

Add a "New conversation" control. It starts a new thread (the thread id lives in sessionStorage, `client.ts:56`) without the fixture-only `/api/reset` (`guest-server.ts:2297`). When a request is live, confirm in the page first and say the request is unaffected.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC1: Starting a new conversation doesn't withdraw or cancel an existing Booking Request, and says so.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0079 | Starting over never cancels committed work |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.

## Comments
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Answer: `scratch/issues/13a-new-conversation.md` (repo root). The new conversation starts a new `g-` thread with no reset and no command (ADR-0079). `GET /api/committed-work` lists live Booking Requests, offers and Reservations, and the client confirms before starting. An offer the original tab never saw is judged from the durable offer (44f15bb).
  - Evidence: test/guest-new-conversation.test.ts; test/guest-new-conversation-chromium.test.ts (375px, 1280px, 320px). Code: apps/local-guest/src/client.ts (`startNewConversation`); apps/local-guest/src/guest-server.ts (`committedWork`, `GET /api/committed-work`). Landing: PR #65, commits bf88e79, 44f15bb.
  - Verified: non-browser tests for this group were run on 11 Oct 2026 (75 of 75 pass).
  - Not verified: real-Chrome tests (`*-chromium.test.ts`, `mobile-guest-journey-chromium.test.ts`) were not run in the reconciliation sandbox (no Chrome); they pass in the CI `browser` job on main. The 320/390/768/1280 screenshots and the ADR 0078 capture sweep were not re-checked. The Definition of Done checklist was not re-ticked item by item in this reconciliation.
