# Complete a same-day booking without shortcuts

Status: ready-for-agent
Type: AFK
User stories: 18–20

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Complete a same-day Booking Request and payment through the ordinary identity, eligibility, Operator response, payment, and contracting path while enforcing the three-hour Latest Disclosure Cutoff and Unit readiness requirements.

## Acceptance criteria

- [ ] Same-day requests receive no identity, payment, authority, inspection, availability, or confirmation shortcut.
- [ ] Disclosure is rejected when the ordinary response and payment lifecycle cannot finish before the safe cutoff.
- [ ] Access instructions release only after the same-day Unit is Ready for Arrival and the booking is confirmed.
- [ ] Boundary-time, readiness-change, payment-expiry, and competing-inventory cases are covered end to end.

## Blocked by

- [Issue 08](08-submit-and-resolve-a-timed-booking-request.md)
- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
- [Issue 14](14-qualify-same-day-turnover.md)
