# Present the Booking Contract and release protected arrival data

Status: ready-for-agent
Type: AFK
User stories: 10–11, 33, 37

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Provide the authenticated guest with the durable Booking Contract, current booking details, material disclosures, full address after confirmed payment, and access instructions only when the authorized release policy is satisfied. Prefer secure references for restricted location and access data.

## Acceptance criteria

- [ ] The contract displays the captured parties, Unit, stay, money, deposit, policies, disclosures, and versions.
- [ ] Full address and access instructions are tenant-scoped and released only at the accepted lifecycle points.
- [ ] Interaction logs and model context do not retain unredacted protected access material unnecessarily.
- [ ] Revoked, cancelled, cross-tenant, and premature requests fail without leaking whether protected data exists.

## Blocked by

- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
