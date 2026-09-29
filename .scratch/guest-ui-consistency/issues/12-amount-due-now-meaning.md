# Decide what "Amount due now" and "Amount paid" mean

Status: needs-info
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
