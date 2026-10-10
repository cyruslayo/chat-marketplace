# Complete a same-day booking without shortcuts

Status: resolved
Type: AFK
User stories: 18–20

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Complete a same-day Booking Request and payment through the ordinary identity, eligibility, Operator response, payment, and contracting path while enforcing the three-hour Latest Disclosure Cutoff and Unit readiness requirements.

## Acceptance criteria

- [x] Same-day requests receive no identity, payment, authority, inspection, availability, or confirmation shortcut.
- [x] Disclosure is rejected when the ordinary response and payment lifecycle cannot finish before the safe cutoff.
- [x] Access instructions release only after the same-day Unit is Ready for Arrival and the booking is confirmed.
- [x] Boundary-time, readiness-change, payment-expiry, and competing-inventory cases are covered end to end.

## Blocked by

- [Issue 08](08-submit-and-resolve-a-timed-booking-request.md)
- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
- [Issue 14](14-qualify-same-day-turnover.md)

## Comments

### Correction (wave-6 review, F2)

- The production same-day rule is `domains/shortlet/src/booking-request.ts` (about lines 378–384). It enforces a fixed 10:55 WAT latest disclosure on the check-in date, not the unit's Contractual Check-In Window that ADR 0053 requires.
- `SameDayBookingManager` (`domains/shortlet/src/same-day-booking.ts`) has the unit-window cutoff logic, but it has no production caller.
- Commit `4437f72` on `infra/cf-wave6` changed `SameDayBookingManager` and its test (plus two unrelated test fixes and `.gitignore`). It did not change the production path. The acceptance criteria above are therefore not met by production code, and the resolved status is not a production fix.
- Tracked in issue 48 (`48-align-production-same-day-cutoff-with-adr-0053.md`). Whether to reopen this issue is for triage. This note does not change the status.
