# Amend dates, occupants, price, or checkout atomically

Status: ready-for-agent
Type: AFK
User stories: 41–43

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Create a versioned Booking Amendment that revalidates availability, eligibility, authority, inspection, stay limits, quote, policies, payment, and aggregate versions before replacing material Booking Contract terms. Keep the original contract valid until the amendment commits.

## Acceptance criteria

- [ ] Date changes, extensions, occupants, price, and checkout follow their accepted submission and completion deadlines.
- [ ] Primary Guest replacement remains prohibited and late first access remains a human-approved exception only.
- [ ] Additional collection or refund completes as part of the accepted amendment outcome without partial contract mutation.
- [ ] Chat, Operator promises, stale surfaces, and failed payments cannot alter contractual state.

## Blocked by

- [Issue 05](05-block-and-hold-unit-availability.md)
- [Issue 06](06-produce-an-all-in-stay-total.md)
- [Issue 13](13-present-contract-and-release-arrival-data.md)
