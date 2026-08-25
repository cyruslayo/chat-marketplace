# Present the Booking Contract and release protected arrival data

Status: resolved
Type: AFK
User stories: 10–11, 33, 37

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Provide the authenticated guest with the durable Booking Contract, current booking details, material disclosures, full address after confirmed payment, and access instructions only when the authorized release policy is satisfied. Prefer secure references for restricted location and access data.

## Acceptance criteria

- [x] The contract displays the captured parties, Unit, stay, money, deposit, policies, disclosures, and versions.
- [x] Full address and access instructions are tenant-scoped and released only at the accepted lifecycle points.
- [x] Interaction logs and model context do not retain unredacted protected access material unnecessarily.
- [x] Revoked, cancelled, cross-tenant, and premature requests fail without leaking whether protected data exists.

## Answer

Booking Contract presentation now uses authoritative card and bank-transfer contract state. Guest access is Primary-Guest and tenant scoped; ordinary artifacts, A2UI, fallback projections, and audit records contain only safe facts and opaque protected-data references, never raw address or access material. Full address is delivered only through the authenticated protected view after a confirmed booking. Access instructions remain fail-closed until an authoritative disclosure policy permits release. Cancelled, revoked, cross-tenant, wrong-principal, unknown, and premature requests fail without enumeration. Conventional web and Weaver presentations share the same canonical artifact. Final validation: 354 tests passed, `npm run check`, `npm run verify:weaver`, and `git diff --check` passed.

## Blocked by

- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
