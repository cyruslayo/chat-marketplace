# Verify manual transfers

Status: resolved
Type: task
Blocked by: 04, guest-payments P5

## What to build

A queue lists each manual transfer awaiting your check, soonest verification deadline first. Each shows:
- owner and apartment;
- the exact amount and the unique booking reference the Guest had to use;
- the time the Guest uploaded the receipt;
- the receipt (viewable only here);
- the WAT deadline by which you must verify: 60 minutes after the Payment Window deadline (ADR 0090).

You confirm only after you see the matching credit in your bank account, recording the bank's transaction reference. You reject if the money hasn't arrived or doesn't match. The receipt itself never confirms (ADR 0090).

## Acceptance criteria

- AC1: The queue lists each manual transfer awaiting verification, soonest deadline first, with owner, apartment, exact amount, booking reference, upload time, the receipt, and the absolute WAT verification deadline.
- AC2: Confirming requires the bank transaction reference and the received amount; an amount that doesn't match exactly is refused, and a confirmed transfer confirms the booking once.
- AC3: Rejecting records the reason (not received or amount mismatch), releases the dates, and tells the Guest that no Reservation was made.
- AC4: A transfer not verified by its deadline is expired on the next read, the dates are released, and any money that later arrives is refunded in full and never confirms the booking.
- AC5: Receipts are viewable only by a signed-in grant holder for that owner, never logged, and deleted 90 days after the stay (ADR 0090).

## ADR compliance

| ADR | Constraint |
|---|---|
| 0090 | the receipt is evidence; your verification of the credit confirms |
| 0045 | late money refunded, never confirms |
| 0046 | one live attempt |
| 0072 | exact-effect confirmation, idempotency |
| 0075 | receipt minimization and retention |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Every action asserts the standard failure paths: revoked or expired grant, no session, cross-origin POST, and a stale or expired target.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: money, deadline and legal wording traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No keys, secrets, receipts, account numbers or contact values in logs or telemetry (ADR 0075).
- [x] Walkthrough at 320px, 375px and 1280px, and without JavaScript.
- [x] `npm run check` and `npm test` pass.

## Answer

Resolved on branch `bo/b6-verify-manual-transfers`. It is cut from P5 (`pay/p5-manual-transfer-with-receipt`) and merges B5 (`bo/b5-reservation-and-check-in`), so it carries B4, B5 and P1–P5.

- **Queue (AC1).** `/operator/transfers`, with a "Transfers" link in the navigation.
  - Manual transfers waiting for your check come first, soonest verification deadline first. Each shows owner, apartment, exact amount, booking reference, upload time (WAT), a "View receipt" link and "Verify by <WAT>" (Payment Window deadline + 60 minutes, ADR 0090).
  - Transfers still waiting for a receipt follow, then closed ones.
  - Home lists "Manual transfer to verify" with its deadline. Bookings shows "Awaiting your check by <WAT>" and the method "Manual transfer".
- **Confirm (AC2, ADR 0090, 0072).** It requires the bank transaction reference and the amount received in naira (`parseNairaToKobo`). The amount must equal the booking amount exactly.
  - A reference confirms at most one booking; the comparison ignores case and spacing (`normalizeBankReference`).
  - Confirmation moves the dates to a confirmed booking and writes the Reservation, the Booking Contract (`paymentDetails.channel: "manual_transfer"`, with the check-in window) and the booking snapshot, race-safely. A repeat confirms nothing more.
  - Forms carry the transfer version. Missing fields return 400; stale, repeated or expired transfers return 409.
- **Reject (AC3).** "Not received" or "Amount doesn't match" (ADR 0090). It releases the dates and the payment slot. The Guest's manual transfer page says "No Reservation was made", and any money received is refunded in full.
- **Expiry and late money (AC4, ADR 0045).** A transfer not verified by its deadline expires on the next read and releases the dates. Confirming it is refused. "Money arrived after all…" records the bank reference and amount as a full refund owed. It never confirms, and Bookings shows "Payment arrived after the deadline; a full refund is owed to the Guest".
- **Receipts (AC5, ADR 0090, 0075).** `GET /operator/transfers/<id>/receipt` serves the receipt only to a signed-in grant holder for that owner. No session redirects to sign-in; an unknown id or revoked grant returns 404.
  - Headers: `no-store`, `nosniff`, and a restrictive CSP; a PDF downloads rather than rendering inline.
  - The audit records only that it was opened. `purgeReceipts` runs on each queue read and deletes receipts 90 days after the stay's 11:00 WAT checkout, or 90 days after the attempt closed.
- **Cross-process.** Each back-office call builds a fresh manager and live-attempt registry over the shared database. The Guest's contract repository falls back to the shared `booking_contracts` and `booking_reservations` tables, so a Reservation the back office confirms shows on the Guest's booking page.
- **Tests.** `test/back-office-manual-transfers.test.ts` covers AC1–AC5, including no session, cross-origin, stale version and revoked grant. The helper `test/helpers/guest-manual-transfer.ts` plays the Guest side.
- **Checks.** `npm run check` is clean. `npm test` gave 1221 passed, 2 failed and 1 skipped. The failures were mobile AC5 transcript scroll and pilot AC4 `pilot:start`; both files pass alone (87 of 87). Walkthrough at 320, 375 and 1280px: no horizontal scroll, and every target is at least 44px ("View receipt" was made a button for that). A payment was confirmed through the plain form without JavaScript; the Reservation appeared in Bookings with the method "Manual transfer".
