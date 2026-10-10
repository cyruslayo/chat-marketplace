# Completed Stay projection and Stay History query

Status: ready-for-agent
Type: task
Blocked by: 01, A-05
Requested: 2 Oct 2026

## Why

There is no completed or past stay state anywhere. Bookings live as `guest_booking_snapshots` (by reservation id) and `booking_reservations` / `booking_contracts` (`domains/shortlet/src/booking-state.ts`), with no query by Guest. Reviews (ADR 0066) need `isCompleted`, and "My stays" needs upcoming vs past.

## What to build

- A pure projection `projectStayStatus(reservation, contract, accessStatus, now, options)` in `domains/shortlet/src/` returning `upcoming` | `in_stay` | `completed` | `past_unverified` | `cancelled` (issue 01 answers 1 and 7). `completed` requires the Contractual Checkout to have passed **and** Verified Access; past checkout without Verified Access (including a no-show) is `past_unverified`, shown under Past and not reviewable.
  - Evaluated lazily against `now` (AGENTS anti-pattern 2). No grace period (issue 01 answer 1).
  - Stay History lists confirmed Reservations only (including later-cancelled ones); declined or expired Booking Requests are not stays.
  - Uses the Contractual Checkout, including an accepted checkout amendment (ADR 0060), and Verified Access from `AccessStatus` (`domains/shortlet/src/checkin-support.ts:4`).
  - Supplies `BookingStateForReview` for `VerifiedStayReviewManager` (`isPaid`, `isCompleted`, `checkoutDate`, `verifiedAccessStatus`).
- A Stay History query: given an account's Linked Principals (A-05), return its Reservations with unit title, neighbourhood, dates and stay status. Add an index or a `primary_guest_id` lookup path; do not rewrite existing rows.
- The query is tenant-scoped and fails closed on missing tenant or principal set.

## Acceptance criteria

- AC1: A Reservation before check-in projects `upcoming`; at or after the Contractual Checkout with Verified Access, `completed`. Failure path: with no Verified Access recorded it projects `past_unverified`, never `completed`.
- AC2: An accepted late-checkout amendment moves the completion time.
- AC3: The status changes as the injected clock moves, with no write to storage.
- AC4: Stay History returns Reservations from every Linked Principal of the account and from no other principal; a cross-tenant query returns nothing.
- AC5: `BookingStateForReview` produced from the projection is accepted by `VerifiedStayReviewManager.submitReview` for a completed stay and rejected for an upcoming one.
- AC6: A cancelled Reservation is returned with status `cancelled`; a declined or expired Booking Request is not returned.

## Tests to add/update

New `test/stay-status-projection.test.ts` and `test/stay-history-query.test.ts`. Use the local pilot clock helpers already used by checkout tests.

## ADR compliance

0004, 0031, 0032, 0033, 0060, 0066, 0070, 0091 (Verified Access from the back office).
