# Amend dates, occupants, price, or checkout atomically

Status: resolved
Type: AFK
User stories: 41–43

## ADR Compliance
- ADR 0012: Primary Guest replacement is strictly prohibited.
- ADR 0023, 0032, 0033, 0055, 0056, 0057 & 0060: Versioned booking amendments revalidate availability, 14-night max stay limit, 90-day booking horizon, inspection, authority, checkout limit (<=14:00 WAT without same-day check-in), and submission deadlines (>=24h check-in date change, 18:00-20:00 WAT day before checkout extension). Atomic payment commitment leaves original contract unchanged on failure. Chat / informal promises rejected.

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
