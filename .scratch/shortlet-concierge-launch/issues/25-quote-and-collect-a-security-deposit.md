# Quote and collect a capped Refundable Security Deposit

Status: resolved
Type: AFK
User stories: 58

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Calculate the Refundable Security Deposit as the lower accepted percentage and Unit-size cap, show it separately from the All-In Stay Total and Commissionable Operator Revenue, collect it through the platform payment path, and account for it as refundable guest money.

## Acceptance criteria

- [x] Studio/one-bedroom, two-bedroom, and larger-Unit caps and the 25% accommodation limit are tested exactly.
- [x] The deposit is not commissionable revenue and remains separately identifiable in projections and ledger entries.
- [x] Quote, payment, contract, cancellation, and refund paths preserve the same deposit amount and policy version.
- [x] No Operator can demand additional cash or direct-transfer security money.

## Answer

Repaired the real Card and Bank application wiring for the ADR-0063 versioned Refundable Security Deposit snapshot with exact 25% and Unit-size caps, captured immutably from Quote through Conditional Offer and Booking Contract. Card and Bank now expose a truthful deposit-required stage and generated Weaver event progression. Stay-first sequencing uses separate actual transactions, one active provider attempt at a time, and the original Payment Window for both components; Booking forms only after required obligations settle. Partial-payment compensation is retryable from the original source with stable obligation identity, exact provider amount/currency validation, and truthful pending/reconciliation outcomes. Successful deposit payment source binding and collection accounting are idempotent; cancellation pending replay is also idempotent. Final Booking formation commits Contract and Reservation atomically where available and releases/compensates on failure, including both settled payment components. Ordinary booking ledgers contain stay money only. Trusted PSP and Nigerian-counsel capability remains fail-closed unless approved. The concrete accounting-backed cancellation/No-Show adapter performs a separate full deposit refund and projects its outcome separately. HeldSecurityDepositSource remains available. Issue 26/27 claim and appeal workflows were not implemented. LOCAL validation: `npm run check`, `npm run verify:weaver`, full suite **461 passed, 0 failed, 0 skipped, 0 todo** (+2 from 459), and `git diff --check` passed.

## Blocked by

- [Issue 06](06-produce-an-all-in-stay-total.md)
- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
