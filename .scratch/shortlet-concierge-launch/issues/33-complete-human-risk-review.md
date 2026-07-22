# Complete predictable Human Risk Review before disclosure

Status: ready-for-agent
Type: AFK
User stories: 88, 92

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Route only policy-defined booking risk to an authorized Human Risk Review before Booking Request disclosure, expire the review at the earlier 24-hour maximum or Latest Disclosure Cutoff, and preserve human authority over adverse eligibility decisions.

## Acceptance criteria

- [ ] Automatic progression, human review, rejection, expiry, and cancellation use explicit reason codes and deadlines.
- [ ] Review never consumes the protected Operator response and payment lifecycle or creates an indefinite hold.
- [ ] Internal risk scores and restricted evidence remain outside guest and Operator interaction projections.
- [ ] Solely automated adverse final decisions are impossible, and authorized review is auditable and tenant-scoped.

## Blocked by

- [Issue 07](07-verify-primary-guest-payer-and-occupants.md)
- [Issue 08](08-submit-and-resolve-a-timed-booking-request.md)
- [Issue 17](17-transfer-an-active-matter-to-a-human.md)
