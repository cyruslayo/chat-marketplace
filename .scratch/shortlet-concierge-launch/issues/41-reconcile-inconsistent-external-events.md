# Reconcile late, duplicate, and inconsistent external events

Status: resolved
Type: AFK
User stories: 31–32, 89, 93

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Give authorized staff deterministic recovery views and commands for late or duplicate payments, refund drift, delayed settlements, unmatched provider references, duplicated callbacks, notification failure, and financial inconsistency without direct database manipulation.

## Acceptance criteria

- [x] Every case preserves original provider payload provenance in a restricted store and exposes only redacted operational facts.
- [x] Recovery commands are authorized, idempotent, expected-version checked, auditable, and balanced in the ledger.
- [x] Reprocessing cannot form duplicate Reservations, refunds, releases, claims, or fund movements.
- [x] Staff and guest/Operator projections update from the committed correction and clearly distinguish pending provider completion.

## Blocked by

- [Issue 11](11-expire-transfer-and-refund-late-payment.md)
- [Issue 24](24-account-for-a-protection-fund-remedy.md)
- [Issue 28](28-post-commission-and-revenue-release.md)
- [Issue 39](39-prove-external-provider-contracts.md)

## Comments

Implemented in `packages/platform-core/src/reconciliation.ts` with unit tests in `test/reconcile-inconsistent-external-events.test.ts`.

### ADR Compliance Summary
- **ADR 0001 & ADR 0002**: Merchant of record and store checkouts webhook events/callbacks are stored with payload provenance while operational facts remain redacted.
- **ADR 0021 & ADR 0024**: Single revenue release per booking model is preserved during reprocessing to avoid duplicate payouts.
- **ADR 0045 & ADR 0046**: Single refund for late payments and single live payment attempt enforcement prevent duplicate reservations/refunds.
- **ADR 0072**: Recovery commands use PlatformCommandEnvelope with staff role authorization, idempotency keys, expected-version check, double-entry ledger balance guard, and audit trail.
- **ADR 0079 & ADR 0080**: Reconciled state updates projections deterministically for staff, guest, and operator views while explicitly distinguishing pending provider completion status.
