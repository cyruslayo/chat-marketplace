# Waiting states with server-driven countdowns

Status: resolved
Type: task
Blocked by: 08
Findings: F7 (see ../PRD.md)

## What to build

For awaiting-Operator and payment-window states, show a countdown to the deadline taken from the server, plus what happens on accept, decline and expiry, and what the guest can do meanwhile. Refetch authoritative state when the countdown reaches zero or when the tab becomes visible.

## Decision: no guest withdrawal at launch (approved 25 Sept 2026)

- **No "Withdraw request" action.** The Booking Request states (`draft`, `disclosed`, `delivery_failed`, `expired`, `confirmed`, `declined` in `domains/shortlet/src/booking-request.ts`) have no withdrawal, and no ADR grants one. Adding it would let a guest hold an apartment's dates for 30 minutes at no cost, so it needs its own ADR, not a UX change.
- **Say what the free exit is.** While waiting, tell the guest that nothing is charged until they accept an offer and pay (ADR 0005), and that if they change their mind they can leave the offer unaccepted; when it expires the dates are released. The final wording must come from the issue 07 glossary.
- **Follow-up, not in this issue:** an explicit "Decline offer" on the Conditional Booking Offer. Offers today can only expire or go stale (`conditional-offer.ts`). It would release dates early, but it needs a small ADR first. Revisit withdrawal during the wait only if pilot data shows guests need it.

## Acceptance criteria

- AC1: The countdown uses the server deadline; changing the client clock doesn't move the displayed deadline time.
- AC2: At zero, the UI refetches state and never marks the request expired on its own.
- AC3: Each waiting state lists the outcomes the guest will see next.
- AC4: The guest can keep chatting during the wait.
- AC5: No awaiting-Operator surface offers a withdraw or cancel action for the Booking Request.
- AC6: The awaiting-Operator surface states that nothing is charged until the guest accepts an offer and pays.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0005 | Operator confirmation leads to an offer; nothing is reserved or charged until verified payment |
| 0041 | Disclosed request blocks inventory for 30 minutes |
| 0044 | Payment reservation lasts 20 + 10 minutes |
| 0045 | Late payments are refunded |
| 0079 | Browser timers never own contractual deadlines |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.

## Comments
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Answer: `scratch/issues/10-waiting-states.md` (repo root). `#waitingFor` builds the waiting state on each response from the authoritative artifact (ADR-0041 operator deadline, ADR-0044 payment window); it is never stored. The countdown is `deadlineAt` minus `serverNow`, and expiry comes only from the server. There is no withdraw action, and the composer is never disabled.
  - Evidence: test/guest-waiting-states.test.ts (AC1–AC6 over HTTP, with failure paths); test/guest-waiting-states-chromium.test.ts (AC1, AC2). Code: apps/local-guest/src/guest-server.ts (`#waitingFor`); apps/web-agent/src/guest-content.ts (`guestWaitingCopy`). Landing: PR #60, commit 68b390d.
  - Verified: non-browser tests for this group were run on 11 Oct 2026 (75 of 75 pass).
  - Not verified: real-Chrome tests (`*-chromium.test.ts`, `mobile-guest-journey-chromium.test.ts`) were not run in the reconciliation sandbox (no Chrome); they pass in the CI `browser` job on main. The 320/390/768/1280 screenshots and the ADR 0078 capture sweep were not re-checked. The Definition of Done checklist was not re-ticked item by item in this reconciliation.
