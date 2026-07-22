# Reconcile late, duplicate, and inconsistent external events

Status: ready-for-agent
Type: AFK
User stories: 31–32, 89, 93

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Give authorized staff deterministic recovery views and commands for late or duplicate payments, refund drift, delayed settlements, unmatched provider references, duplicated callbacks, notification failure, and financial inconsistency without direct database manipulation.

## Acceptance criteria

- [ ] Every case preserves original provider payload provenance in a restricted store and exposes only redacted operational facts.
- [ ] Recovery commands are authorized, idempotent, expected-version checked, auditable, and balanced in the ledger.
- [ ] Reprocessing cannot form duplicate Reservations, refunds, releases, claims, or fund movements.
- [ ] Staff and guest/Operator projections update from the committed correction and clearly distinguish pending provider completion.

## Blocked by

- [Issue 11](11-expire-transfer-and-refund-late-payment.md)
- [Issue 24](24-account-for-a-protection-fund-remedy.md)
- [Issue 28](28-post-commission-and-revenue-release.md)
- [Issue 39](39-prove-external-provider-contracts.md)
