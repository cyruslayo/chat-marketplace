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

- [x] Date changes, extensions, occupants, price, and checkout follow their accepted submission and completion deadlines.
- [x] Primary Guest replacement remains prohibited and late first access remains a human-approved exception only.
- [x] Additional collection or refund completes as part of the accepted amendment outcome without partial contract mutation.
- [x] Chat, Operator promises, stale surfaces, and failed payments cannot alter contractual state.

## Answer

Implemented the versioned Booking Amendment slice. Material amendments are Primary-Guest and tenant scoped; proposals remain separate from explicit acceptance, with contract, quote, and validation versions rechecked. Dates, occupants, Checkout, and the revised quote commit atomically. Checkout Amendment persists into the durable Booking Contract, and Issue 18 reads that same durable term. Additional collection and refund use trusted provider state, not client results; the original contract remains valid until settlement and commit succeed. Primary Guest replacement is rejected, and late first access after 22:00 WAT requires trusted human approval. Conventional web and Weaver use the same canonical amendment state.

Local validation: focused tests 34 passed, 0 failed, 0 skipped, 0 todo; full suite 379 passed, 0 failed, 0 skipped, 0 todo; `npm run check`, `npm run verify:weaver`, and `git diff --check` passed.

## Blocked by

- [Issue 05](05-block-and-hold-unit-availability.md)
- [Issue 06](06-produce-an-all-in-stay-total.md)
- [Issue 13](13-present-contract-and-release-arrival-data.md)
