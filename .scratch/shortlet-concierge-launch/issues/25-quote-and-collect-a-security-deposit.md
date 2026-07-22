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

## Blocked by

- [Issue 06](06-produce-an-all-in-stay-total.md)
- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
