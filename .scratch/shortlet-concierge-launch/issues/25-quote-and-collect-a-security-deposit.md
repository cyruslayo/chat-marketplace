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

Implemented the ADR-0063 versioned Refundable Security Deposit snapshot with exact 25% and Unit-size caps, captured immutably from Quote through Conditional Offer and Booking Contract. The deposit remains outside the All-In Stay Total and commission; total cash requirement still displays stay plus deposit. Card and bank collection now use separate actual transactions in a stay-first staged journey, one active provider attempt at a time, with the original Payment Window shared by both and booking confirmation only after all required obligations settle. Partial payment compensation uses the original source and deterministic replay. Trusted PSP and Nigerian-counsel capability remains fail-closed and disabled unless approved. Shared held-deposit accounting provides balanced liability journals and a HeldSecurityDepositSource. Cancellation/No-Show supports a separate full deposit refund. Conventional and Weaver projections remain minimized. Issue 26/27 claim and appeal workflows were not implemented. LOCAL validation: `npm run check`, `npm run verify:weaver`, and full suite **456 passed, 0 failed, 0 skipped, 0 todo**; `git diff --check` passed.

## Blocked by

- [Issue 06](06-produce-an-all-in-stay-total.md)
- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
