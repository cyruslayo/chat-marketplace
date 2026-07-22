# Issue and explicitly accept a Conditional Booking Offer

Status: resolved
Type: AFK
User stories: 24, 41–43, 97

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

After Operator confirmation, issue a versioned Conditional Booking Offer containing the exact parties, Unit, dates, occupants, quote, deposit, policies, disclosures, Payment Window, and material consequences. Require explicit guest acceptance bound to the displayed version before payment can begin.

## Acceptance criteria

- [x] Offer creation revalidates current Unit eligibility, authority, availability, quote, and aggregate versions.
- [x] Acceptance uses a short-lived, single-use confirmation token bound to actor, terms, amounts, deadline, and expected version.
- [x] Stale, changed, expired, replayed, or cross-tenant offers cannot progress.
- [x] Conventional and Generative Surface acceptance reach the same command and audit classification.

## Blocked by

- [Issue 08](08-submit-and-resolve-a-timed-booking-request.md)

## Answer
Issue implemented and code review findings addressed in commit e3c6999.
