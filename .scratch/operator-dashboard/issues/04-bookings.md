# Bookings and their payment state

Status: resolved
Type: task
Blocked by: 03

## What to build

A read-only Bookings page lists every confirmed request with its owner, apartment, dates and current stage:
- offer issued;
- awaiting payment (card, Paystack transfer, or manual transfer awaiting your check);
- Reservation confirmed;
- ended (offer or payment window expired, payment refunded).

It is read from the artifacts on each view and never issues a command.

## Acceptance criteria

- AC1: Every confirmed request appears with its owner, apartment, current stage and payment method, read from the authoritative artifacts on each view.
- AC2: Payment deadlines are shown as absolute WAT, and an ended booking says why without card or account details.
- AC3: Only bookings for owners you hold a grant for are listed, and any other booking is not found.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0005 | a Reservation only after verified payment |
| 0044 | Payment Window deadlines |
| 0077 | no recalculation |
| 0075 | no payment instrument details |
| 0082 | owner scope from grants |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Every action asserts the standard failure paths: revoked or expired grant, no session, cross-origin POST, and a stale or expired target.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: money, deadline and legal wording traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No keys, secrets, receipts, account numbers or contact values in logs or telemetry (ADR 0075).
- [x] Walkthrough at 320px, 375px and 1280px, and without JavaScript.
- [x] `npm run check` and `npm test` pass.

## Answer

Resolved on branch `bo/b4-bookings` (off `main`, after B3 merged).

- **Where:** `/operator/bookings` (list) and `/operator/bookings/<requestId>` (detail), plus a "Bookings" link in `BACK_OFFICE_NAV`. Both are GET only; there is no POST route, so the page cannot issue a command.
- **Projection:** `apps/local-owner/src/booking-projection.ts` has a pure `projectBookingStage` that returns the stage, payment method, Payment Window deadline, any grace end, and the ended reason.
- **Read path:** `env.listOperatorBookings` / `env.operatorBooking` read these records on every call:
  - the confirmed request;
  - the stored offer (`guest_conditional_offers`);
  - the payment journey (`booking_payment_journeys`, a fresh repository per read);
  - the Live Payment Attempt;
  - the booking snapshot and Reservation row.
  - The in-memory offer and journey caches are never used, so a payment written by the Guest server's connection shows on the next view.
- **Stages:** "Offer issued", "Awaiting payment", "Reservation confirmed" and "Ended", plus "Confirmed; no offer issued" for the edge where the offer could not be issued after confirmation. Payment methods are "Card", "Paystack transfer" or "Not chosen yet".
- **ADR mapping:**
  - 0005: "Reservation confirmed" only when a committed Reservation exists.
  - 0044: "Pay by" is the offer's `paymentWindow.expiresAt`. An in-flight transaction shows "Payment-Processing Grace until" its end. `PAYMENT_PROCESSING_GRACE_MINUTES` and `paymentProcessingGraceEndsAt` now live in `booking-payment-journey.ts`, and the card and bank-transfer managers use the constant instead of `10 * 60 * 1000`. Expiry is evaluated lazily on read (no background job).
  - 0045: ended reasons never describe a started refund as received ("Refund started; not yet received by the Guest", "Payment refunded in full", "Payment arrived after the deadline; a full refund is owed to the Guest").
  - 0075: no card, reference, account or contact value is rendered or logged.
  - 0077: amounts and deadlines come from the offer snapshot and are never recalculated.
  - 0082: every read re-checks the grant; an unknown id, an unconfirmed request and another owner's booking all return 404 "Booking not found".
- **Not yet:** "manual transfer awaiting your check" needs guest-payments P5 (ADR 0090), which is not built. B6 adds that method and stage.
- **Test helper:** `test/helpers/guest-card-payment.ts` (`guestCardPayments`) plays the Guest side of a card payment against the operator environment's SQLite file through its own connection: `accept`, `startCard`, `verify(status)`, `pay`.
- **Walkthrough:** checked at 320px, 375px and 1280px with a seeded server holding one booking at each stage. There is no horizontal scroll and every target is at least 44px. The pages carry no script, so they are identical without JavaScript.
- **Checks:** `npm run check` is clean. `npm test` gave 1197 passed, 2 failed and 1 skipped. The two failures were guest cross-tab AC1 and RB5; both files pass alone (30 of 30).
