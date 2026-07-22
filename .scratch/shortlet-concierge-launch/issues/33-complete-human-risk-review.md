# Complete predictable Human Risk Review before disclosure

Status: resolved
Type: task
User stories: 88, 92

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Route only policy-defined booking risk to an authorized Human Risk Review before Booking Request disclosure, expire the review at the earlier 24-hour maximum or Latest Disclosure Cutoff, and preserve human authority over adverse eligibility decisions.

## Acceptance criteria

- [x] Automatic progression, human review, rejection, expiry, and cancellation use explicit reason codes and deadlines.
- [x] Review never consumes the protected Operator response and payment lifecycle or creates an indefinite hold.
- [x] Internal risk scores and restricted evidence remain outside guest and Operator interaction projections.
- [x] Solely automated adverse final decisions are impossible, and authorized review is auditable and tenant-scoped.

## Blocked by

- [Issue 07](07-verify-primary-guest-payer-and-occupants.md)
- [Issue 08](08-submit-and-resolve-a-timed-booking-request.md)
- [Issue 17](17-transfer-an-active-matter-to-a-human.md)

## Comments

- ADR Compliance: ADR 0011 (primary guest verification before disclosure), ADR 0051 (predictable risk review before disclosure without operator notification or inventory hold), ADR 0052 (review deadline bounded to earlier of 24h or Latest Disclosure Cutoff), ADR 0053 (Latest Disclosure Cutoff is 3h before check-in), ADR 0075 (redaction of internal risk scores and evidence in projections), ADR 0076 (human takeover: solely automated adverse decisions prohibited).

## Answer

Implemented `HumanRiskReviewManager` in `domains/shortlet/src/human-risk-review.ts` and unit tests in `test/complete-human-risk-review.test.ts`. All acceptance criteria and failure paths are fully verified.

