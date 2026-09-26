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

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

- **Waiting state on the surface.** Each current surface can carry `waiting` (`GuestWaitingState`: kind, heading, `deadlineAt`, `deadlineText`, `serverNow`, outcomes, meanwhile).
  - `LocalGuestApp.#waitingFor` builds it when each response is sent, reading the authoritative artifact every time. It is never stored with the thread.
  - Only two kinds of state have a deadline:
    - A delivered request awaiting the Operator uses `operatorResponseDeadlineAt` (ADR-0041).
    - An open Payment Window uses `paymentWindowExpiresAt` (ADR-0044) and covers two surfaces: the issued offer (`offer-payment-window`) and the ready, checkout or deposit payment surfaces (`payment-window`).
  - A payment that is already processing has no countdown, because it may be in its grace period.
  - Anything expired, declined, not active or past its deadline has no waiting state.
- **Copy.** `guestWaitingCopy` in `guest-content.ts` holds the copy. Each outcome traces to an ADR: 0005 (an offer follows confirmation; nothing is charged until the guest accepts and pays), 0041 (decline or timeout releases the dates), 0044 (the Payment Window deadline) and 0045 (a late payment is refunded). It follows the approved decision:
  - there is no withdraw action;
  - the stated free exit is "leave the offer unaccepted" (AC5, AC6).
  - The copy avoids a second Reservation-status statement, so each surface keeps one status line (issue 07).
- **Client.**
  - `renderWaiting` shows the heading, the absolute WAT deadline (ADR-0078), a countdown, "What happens next" and what the guest can do meanwhile.
  - `startCountdown` computes the remaining time as `deadlineAt − serverNow`, both from the server, and counts it down with `performance.now()`, so changing the device clock moves neither the countdown nor the displayed deadline (AC1).
  - At zero the page shows "Checking the latest status…" and calls `refreshServerState()`. Refetches are at least 5 s apart. The page never sets an expired status itself (AC2).
  - A tab that becomes visible refetches too.
  - The composer is never disabled by a wait (AC4).
- **No-JS.** `renderNoScriptConversationHtml` renders the same text, with the absolute deadline in place of the countdown (ADR-0080).
- **Tests.**
  - `test/guest-waiting-states.test.ts` covers AC1–AC6 over HTTP, with their failure paths: states without a deadline, expiry that only the server reports, forged withdraw and cancel events rejected as `UNSUPPORTED_EVENT`, and a declined request with no wait.
  - `test/guest-waiting-states-chromium.test.ts` covers AC1 (a page `Date` three hours ahead changes nothing) and AC2 (the page refetches at zero and stays active while the server says it's open, then shows "Request expired" once the server's deadline has passed; the composer stays enabled).
- **Walkthrough on :3005.** At 375px the awaiting-Operator panel shows "Response due by 11:30 am WAT, 3 Sept 2026 · 30 min left" and the three outcomes. There is no overflow at 320px or 1280px.
- Verification: `npm run check` passed. `npm test`: 1,128 passed, 0 failed, 1 skipped.
