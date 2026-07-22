# Prove external-provider contracts with automated fixtures

Status: ready-for-agent
Type: AFK
User stories: 107

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Define replaceable adapters for payment, identity, messaging, maps/location, calendar, and notifications, and exercise their externally visible contracts with local fixtures, recorded signed payloads, sandboxes, fake clocks, delayed callbacks, duplicates, unknown states, retries, timeouts, and recovery.

## Acceptance criteria

- [ ] Domain and application services depend on platform-owned provider capabilities rather than vendor types.
- [ ] Request, signature, response mapping, error translation, idempotency, redaction, circuit-breaking, and recovery cases pass.
- [ ] Unknown or contradictory provider states fail safely and create actionable reconciliation context.
- [ ] Automated contract success is recorded separately from production-equivalent capability certification.

## Blocked by

- [Issue 04](04-onboard-and-publish-one-inspected-unit.md)
- [Issue 07](07-verify-primary-guest-payer-and-occupants.md)
- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
- [Issue 34](34-project-artifacts-through-whatsapp.md)
