# Decide what "Amount due now" and "Amount paid" mean

Status: resolved
Type: grilling
Blocked by: none
Requested: 29 Sept 2026

## Why

The same label shows different numbers for the same booking (fixture: All-In Stay Total ₦370,000, Refundable Security Deposit ₦20,000):

| Screen | Label | Shows | Source today |
|---|---|---|---|
| Request review, offer, payment choice | Amount due now / Total to complete booking | ₦390,000 | the offer's `totalAmountDueNowKobo` (stay + deposit) |
| Bank transfer, manual transfer | Amount due now | ₦370,000 | the transfer's `amountKobo` (this stay payment only; the deposit is collected separately, ADR 0089) |
| Confirmed | Amount paid | ₦370,000 | the contract's `amountPaidKobo` (stay payment only; the deposit shows as "collected") |

A guest reading "Amount due now ₦390,000" and then "Amount due now ₦370,000" a moment later can't tell whether the price changed.

## Question for the user

Pick one meaning and we apply it everywhere:

1. **"Amount due now" = everything to complete the booking (₦390,000).** The transfer pages then show "This payment: ₦370,000 (stay)" and "Next: ₦20,000 deposit" instead of reusing the label.
2. **"Amount due now" = the next payment only (₦370,000).** Earlier screens show "Total to complete booking: ₦390,000 (stay ₦370,000 + deposit ₦20,000)".
3. **"Amount paid" on confirmation:** show the stay payment only (today), or stay + deposit collected (₦390,000) as the total paid.

## Acceptance criteria (after the answer)

- AC1: The chosen meaning is recorded here and in `apps/web-agent/src/guest-content.ts`'s label table (issue 04).
- AC2: Every screen that shows the label shows the same meaning. A test walks the fixture journey and asserts the value on each screen.

## Comments

Decided by the assistant on the user's instruction ("resolve with the best language based on UX language principles"), 1 Oct 2026.

### Decision

Principles: one label, one meaning; name a number by what the guest does with it; the total comes first, then the payment in front of them; say only what happened.

| Label | Meaning | Where |
| --- | --- | --- |
| **Total to complete booking** | stay payment plus any Refundable Security Deposit (₦390,000 in the fixture) | request review, offer, payment choice, card handoff, bank-transfer chat surface (replaces "Amount due now") |
| **This payment** | the one payment the screen asks for now: the stay payment, or the deposit when it is next (₦370,000) | bank transfer and manual transfer pages, shown after the total and the deposit |
| **Next payment** | unchanged: what the guest pays after this step | payment choice, card surfaces |
| **Stay payment paid** | the stay payment collected (₦370,000); the deposit keeps its own "Refundable Security Deposit collected" row, so nothing is added together that the guest did not pay in one go | confirmation (replaces "Amount paid") |

Rejected: option 2 ("Amount due now" = next payment only) hides the full cost on the screens where the guest decides, against ADR 0015's all-in principle; a combined "Amount paid ₦390,000" mixes a refundable deposit into what was paid for the stay (ADR 0016, 0089).

### Answer

- `GUEST_FACT_LABELS` in `apps/web-agent/src/guest-content.ts` records the meanings (`amountDueNow` = "Total to complete booking", new `thisPayment`, `amountPaid` = "Stay payment paid"); builders, chat organizers and server kit read the table, so every guest surface changed together. Assistant summaries use the same wording. Operator/back-office screens keep their own labels.
- Transfer pages now show "This payment" for the transfer amount instead of reusing the total's label.
- Tests: `test/guest-amount-labels.test.ts` (AC1 table, AC2 walks review, offer, payment choice, provider transfer, manual transfer, confirmation); existing label assertions and the legacy-label guards in `guest-presentation-contract.test.ts` updated.
- Amounts are unchanged; only labels and the transfer-page row changed. Wording is the assistant's choice within existing vocabulary ("Total to complete booking" and "Next payment" already existed in guest copy); change `GUEST_FACT_LABELS` to reword everywhere.
