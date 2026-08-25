# Cancel under the standardized catalogue and determine No-Show

Status: resolved
Type: AFK
User stories: 48–51

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Calculate guest cancellation under the captured Flexible, Standard, or Firm policy using the Cancellation Base, apply failure and legal overrides, refund always-refundable components, and permit human-confirmed No-Show only after failed contact and the next-day 10:00 AM WAT deadline.

## Acceptance criteria

- [x] Exact boundary tests cover every full, partial, and zero-refund threshold in all three policies.
- [x] Deposit, duplicate payment, unprovided services, cleaning, and attributable refundable tax are excluded as required.
- [x] Cancellation Liability selects the correct guest, Operator, platform, force-majeure, or legal funding outcome.
- [x] Agent, conventional, and support cancellation paths produce the same calculation, command, ledger, and audit evidence.

## Blocked by

- [Issue 13](13-present-contract-and-release-arrival-data.md)
- [Issue 16](16-verify-access-with-live-support.md)

## Answer

Issue 21 is implemented through the authoritative `CancellationNoShowManager` and `CancellationApplication`.

- Requests capture immutable Flexible, Standard, or Firm policy snapshots and versions; later Unit policy changes affect new requests only. Offers and both card and bank Booking Contracts preserve that snapshot.
- Refund timing uses the authoritative Contractual Check-In Window in Africa/Lagos with exact timestamp boundaries. Economics, Cancellation Base, refundable components, commission, and liability are server/provider-owned; trusted reviewed overrides receive full-base treatment.
- Primary Guest and exact tenant authorization are enforced. Reservation transitions are authoritative (`confirmed` → `cancelled` or `no_show`), exact confirmed inventory commitments are released, and cancellation ledger obligations are idempotent.
- Refunds use the Booking Contract's original card or bank-transfer source and expose provider-authoritative pending, settled, or failed status.
- No-Show requires trusted failed required-contact state, the next-day 10:00 AM Africa/Lagos deadline, and an authorized human. Verified Access, late voluntary arrival, failed access, and human review cannot be misclassified.
- One minimized `shortlet.cancellation/v1` artifact feeds the conventional route and Weaver A2UI v0.9.1 Basic Catalog; both use the same application and command semantics.

Validation: `npm run check`, `npm run verify:weaver`, and the full suite pass with 389 tests, 0 failures, 0 skipped, and 0 todo.

