# Reservation detail and recording check-in

Status: resolved
Type: task
Blocked by: 04

## What to build

A Reservation page shows the snapshot facts:
- owner and apartment;
- stay dates and party size;
- arrival window and checkout time;
- the Guest's phone for coordination;
- the amount paid and the payment method.

You can record the Guest's check-in as Verified Access through `CheckInSupportApplication.recordSupportVerification`, which starts the 24-hour clock for the owner payable (ADR 0089). You can also report a Blocking Fulfilment Complaint, which pauses that payable.

## Acceptance criteria

- AC1: The Reservation page shows the owner, apartment, stay dates, party size, arrival window, checkout time, amount paid and payment method from the booking snapshot, without recalculating them.
- AC2: You can record Verified Access for a Reservation, and the page then shows when the owner payable becomes due.
- AC3: You can report a Blocking Fulfilment Complaint, and while it is open the owner payable is not due.
- AC4: Recording Verified Access before the contractual check-in window, or twice, is refused.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0022 | Verified Access through independent evidence (staff verification) |
| 0089 | payable due 24 hours after Verified Access with no blocking complaint |
| 0031/0032 | arrival window and checkout time |
| 0077 | snapshot facts |
| 0075 | minimum Guest data |
| 0091 | back-office check-in recorded as platform support (`authorized_staff`) under the owner grant, with a documented basis |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Every action asserts the standard failure paths: revoked or expired grant, no session, cross-origin POST, and a stale or expired target.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: money, deadline and legal wording traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No keys, secrets, receipts, account numbers or contact values in logs or telemetry (ADR 0075).
- [x] Walkthrough at 320px, 375px and 1280px, and without JavaScript.
- [x] `npm run check` and `npm test` pass.

## Answer

Resolved on branch `bo/b5-reservation-and-check-in`, stacked on B4 (`bo/b4-bookings`). It includes ADR 0091, accepted 27 Sept 2026.

- **Reservation page.** `/operator/bookings/<requestId>` becomes the Reservation page once the booking is a confirmed Reservation. `env.operatorReservation` reads it from the Booking Contract: owner, apartment, dates, party size, arrival window, checkout time, Guest phone, amount paid (`paymentDetails.amountKobo`) and payment method. It does not read the unit, and does not recalculate (ADR 0077). No card, reference or email is shown (ADR 0075).
- **Arrival window (ADR 0031).**
  - `Unit.checkInWindow` is validated by `contractualCheckInWindow` (14:00–22:00 WAT, earliest first).
  - The offer captures it as `offer.checkInWindow`, and the card and bank-transfer managers carry it into `BookingContract.checkInWindow`.
  - Inventory import takes optional `check_in_earliest_access` and `check_in_latest_arrival` columns. The fixtures and the local pilot CSV use 14:00–22:00.
- **Recording Verified Access (ADR 0091, 0022).**
  - `env.recordVerifiedAccess` checks the grant through `operatorReservation`, then runs `recordSupportVerification` as an `authorized_staff` principal for the signed-in actor.
  - It requires one `SUPPORT_VERIFICATION_BASES` code, and the page says the owner's word alone is not enough.
  - The domain refuses a repeat, or a record before the window opens (AC4).
  - The page then shows "Owner payable Due <WAT>", computed by `ownerPayableDueAt` as the protection-window start plus `CHECK_IN_PROTECTION_WINDOW_HOURS` (24) (ADR 0089).
- **Complaints.** `env.reportBlockingComplaint` uses the new domain command `reportBlockingComplaintAsSupport`. It takes a fixed category (`COMPLAINT_CATEGORY_LABELS`) and no free text. While a complaint is open, the payable reads "Not due while a Blocking Fulfilment Complaint is open".
- **Persistence.** `SqliteCheckInSupportStore` (table `checkin_support_state`) holds schedule, window, evidence, result and complaints: ids, times and codes only. `CheckInSupportManager` takes an optional `store` and re-reads it per call, so the state survives a restart (tested) and is shared with the Guest process.
- **Stale actions (ADR 0072).** Forms carry a 16-hex `basedOnVersion`, hashed from the access result and complaints. A mismatch returns 409 and records nothing.
- **Status codes.** Missing session: 401. Cross-origin: 403. Bad or missing field: 400. Refused: 409 with a plain notice. Unknown booking, not a Reservation, or a revoked grant: 404.
- **Deviations from the plan, for review.**
  - A unit *without* a window still gets an offer. Only a malformed window fails the offer. Check-in fails closed instead ("no Contractual Check-In Window on file"). Failing every offer would have meant changing about 40 test unit builders that predate ADR 0031's field.
  - Pilot support coverage (ADR 0030) is scheduled on the first check-in action. The signed-in user is the responder and `config.adminId` is the backup.
  - Resolving a complaint is not in B5; no issue covers it yet.
- **Checks.** `npm run check` is clean. `npm test` gave 1203 passed, 0 failed and 1 skipped.
- **Walkthrough.** Checked at 320, 375 and 1280px with the complaint section open: no horizontal scroll and every target is at least 44px. Verified Access was recorded without JavaScript, and the page showed the due time and removed the access form.
