# Collect guest payments and pay owners the agreed amount

## Context

The business is curated and B2B2C. The platform owner sources apartments from owners, operators and managers, lists and manages every unit, and sells stays to guests. Owners do not sign up or use the platform.

Earlier decisions assumed a different model:
- an operator-funded commission deducted from operator revenue (ADR 0062);
- operator revenue paid out through a PSP-approved delayed-payout structure that the platform must not hold itself (ADR 0021, ADR 0024);
- rolling reserves, payout plans and trust-tier settlement terms (ADR 0025, ADR 0026, ADR 0063, ADR 0083).

The chosen model: the platform collects every guest payment, pays each owner the amount agreed with them, and keeps a margin charged on top.

## Decision

### Price

- For each unit, the platform records the **owner's agreed amounts** (the nightly rate and any mandatory charges) and the **platform margin rate** for that unit. Both are versioned unit configuration, not constants in code.
- The Guest pays the agreed amounts plus the margin. The Guest sees this as one All-In Stay Total that already includes the margin; there is no separate guest fee added later (ADR 0015 is unchanged).
- Example: an owner agrees ₦100,000 for a stay and the unit's margin is 15%. The Guest's All-In Stay Total is ₦115,000, the owner receives ₦100,000, and the platform keeps ₦15,000.

### Collection

- Every guest payment is made to the platform's own Paystack account, by card or bank transfer (ADR 0088).
- The platform's ledger records each booking's amount received, the owner payable and the margin.
- The arrangement is not called escrow.

### Paying owners

- **The owner payable** is the owner's agreed amounts for the booking. It is captured in the booking snapshot when the booking is confirmed and never recalculated afterwards.
- **When it becomes due:** 24 hours after Verified Access, provided no Blocking Fulfilment Complaint is open. This keeps the guest-protection timing of ADR 0021.
- **Changes:** a cancellation or refund changes the owner payable only as the booking's cancellation policy outcome determines (ADR 0014).
- **How it is paid:** the platform pays owners itself, by bank transfer or Paystack Transfers. Each payout is recorded against its booking with its date, amount and reference. Payouts are not automated at launch.
- **The margin** is the platform's revenue. It is earned when the owner payable becomes due.

### Deposits

Launch units carry a zero Refundable Security Deposit, so each booking takes one payment. ADR 0016 already makes deposits optional and keeps their collection switched off until provider and counsel approval. The deposit capability stays in code for later.

### Contracting party

ADR 0006 stands: the owner or operator is the accommodation provider, and the platform is the marketplace and payment-collection agent. Collecting all funds and paying owners must be confirmed by Nigerian counsel and in the Paystack merchant agreement before paid launch, as ADR 0006 already requires.

## Status of earlier decisions

| ADR | Status |
|---|---|
| 0021 | Superseded. Its protection timing is restated above; its payout structure and no-custody rule no longer apply. |
| 0024 | Superseded. There is no PSP-structured Revenue Release; the owner payable becomes due as above. |
| 0025, 0026 | Superseded. There are no rolling reserves or payout plans at launch. |
| 0062 | Superseded. The margin charged on top replaces operator-funded commission. |
| 0063 | Payout-choice and tier-settlement terms are superseded. Deposit caps and remedy limits stand. |
| 0083 | Superseded. There are no trust-tier settlement terms at launch. |
| 0027, 0063 | Protection-fund contributions were defined from earned commission. They are out of launch scope and must be revisited before the fund is used. |

## Consequences

- The Operator back office shows, per booking, the amount received, the owner payable, the margin, when the payable becomes due, and whether it has been paid.
- Unit configuration gains the owner's agreed amounts and the margin rate, and the quote derives the guest price from them.
