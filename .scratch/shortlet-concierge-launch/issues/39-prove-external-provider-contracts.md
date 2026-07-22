# Prove external-provider contracts with automated fixtures

Status: resolved
Type: AFK
User stories: 107

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Define replaceable adapters for payment, identity, messaging, maps/location, calendar, and notifications, and exercise their externally visible contracts with local fixtures, recorded signed payloads, sandboxes, fake clocks, delayed callbacks, duplicates, unknown states, retries, timeouts, and recovery.

## Acceptance criteria

- [x] Domain and application services depend on platform-owned provider capabilities rather than vendor types.
- [x] Request, signature, response mapping, error translation, idempotency, redaction, circuit-breaking, and recovery cases pass.
- [x] Unknown or contradictory provider states fail safely and create actionable reconciliation context.
- [x] Automated contract success is recorded separately from production-equivalent capability certification.

## Blocked by

- [Issue 04](04-onboard-and-publish-one-inspected-unit.md)
- [Issue 07](07-verify-primary-guest-payer-and-occupants.md)
- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
- [Issue 34](34-project-artifacts-through-whatsapp.md)

## Comments

- Implemented `ProviderContractRegistry` and `CircuitBreaker` in `packages/platform-core/src/provider-contracts.ts`.
- Established vendor-neutral platform capability interfaces for payment, identity, messaging, maps, calendar, and notifications (ADR 0004, ADR 0068).
- Implemented signature validation, idempotency caching, error translation, PII/credential redaction (ADR 0075), circuit breaking, and contradictory-state reconciliation context.
- Separated automated contract success recording from production capability certification.
- Covered by unit tests in `test/prove-external-provider-contracts.test.ts`.
