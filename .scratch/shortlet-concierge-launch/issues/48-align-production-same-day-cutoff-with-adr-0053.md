# Align the production same-day cutoff with ADR 0053

Status: needs-triage
Type: AFK
User stories: 18–20

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## Why

Issue 15 is marked resolved, but the production path does not implement ADR 0053.

- `domains/shortlet/src/booking-request.ts` (about lines 378–384) enforces a fixed latest disclosure of 10:55 WAT on the requested check-in date (11:00 cutoff). It does not read the unit's Contractual Check-In Window, which ADR 0053 requires. The fixed 11:00 cutoff equals three hours before a 14:00 window start (ADR 0031 opens launch arrivals at 2 PM), so it is right only for units whose window starts at 14:00.
- `domains/shortlet/src/same-day-booking.ts` (`SameDayBookingManager`) computes a cutoff from the unit and the Africa/Lagos clock. It has no production caller. Only `test/complete-a-same-day-booking.test.ts` constructs it, and its window handling does not match the unit's Contractual Check-In Window either.
- Commit `4437f72` changed `SameDayBookingManager` and its test (plus two unrelated test fixes and `.gitignore`). It did not change the production path.

## What to build

- Compute the Latest Disclosure Cutoff for each Booking Request as three hours before the unit-specific Contractual Check-In Window begins, in Africa/Lagos time (ADR 0053). Use the requested check-in date.
- Replace the fixed 10:55/11:00 check in `booking-request.ts` with that computation, and use one code path for it.
- Decide the fate of `SameDayBookingManager`: wire it into production, or delete it with its test (AGENTS: no speculative dependencies).
- Confirm that the 30-minute response window and the five-minute delivery rule still fit before the cutoff (ADR 0053's maximum 65-minute transactional path).

## Acceptance criteria

- [ ] A Booking Request whose disclosure would fall after its unit's three-hour cutoff is refused with the cutoff named, and one disclosed before it is accepted. Failure path included.
- [ ] The cutoff uses the requested check-in date and the Africa/Lagos clock, and does not depend on the host timezone.
- [ ] No production code path uses a fixed 10:55 or 11:00 WAT constant for the cutoff.
- [ ] A request disclosed before its cutoff keeps its operator and payment windows when they later cross the cutoff (ADR 0053).
- [ ] Issue 15's acceptance criterion on disclosure before the cutoff is re-verified against this path, not `SameDayBookingManager`.

## Needs user

- Whether a unit's Contractual Check-In Window is stored per unit today. `contractualCheckInWindow` in `checkin-support.ts` exists, but its source for units is not confirmed here.
- Whether `SameDayBookingManager` should be kept (wired) or removed.

## Comments

### Filed by the wave-6 review (F2)

Documentation only, from the review of `infra/cf-wave6`. This issue does not claim a fix, and no booking code changed in that review.
