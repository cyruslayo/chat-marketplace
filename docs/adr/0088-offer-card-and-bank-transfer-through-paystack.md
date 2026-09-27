---
status: extended by ADR-0090 (manual bank transfer as a third option)
---

# Offer card and bank transfer through Paystack

## Context

ADR 0087 made the pilot card-only. Nigerian guests most commonly pay by bank transfer, and the business owner will operate one Paystack account for all guest payments (ADR 0089). ADR 0047 already allows bank transfer, but only when the provider supplies an expiring, booking-specific account with exact-amount binding, authenticated status events and provider-enforced non-payability at the 20-minute Payment Window deadline.

Paystack's Pay with Transfer creates a temporary account tied to one transaction. Through the Charge API, the expiry is set per charge with `bank_transfer.account_expires_at`: an expiry under 15 minutes is raised to 15, and one over 8 hours is lowered to 8. Paystack refunds transfers made after expiry. (Sources: Paystack support article "Pay with transfer" and the Charge API documentation, accessed 26 Sept 2026. The support article states a 30-minute default for hosted flows.)

## Decision

Guests choose **card** or **bank transfer** when paying, both through the platform's Paystack account.

- **Card** is unchanged: Paystack hosted checkout, fresh card checkout only (ADR 0049, ADR 0087).
- **Bank transfer** uses the Paystack Charge API `bank_transfer` channel, not hosted checkout. The charge's `account_expires_at` is set to the booking's Payment Window deadline, 20 minutes after Operator confirmation (ADR 0044).
  - The Guest sees the account number, bank, exact NGN amount and the absolute WAT deadline, in the platform's own transfer surface.
  - The transfer runs behind the existing provider-neutral `BankTransferProviderClient` port.
- **Verification:** payment is confirmed only by server-side verification of the designated reference and exact amount, from an authenticated Paystack event (ADR 0047). A client callback or a screenshot never confirms.
- **One live attempt (ADR 0046 is unchanged):**
  - The Guest chooses the method before an attempt begins.
  - A transfer account that is still payable holds the attempt slot, so the Guest cannot switch to card until it has expired.
  - The payment surface states this before the Guest chooses.
- **Late money:** ADR 0045 and ADR 0047 apply. Inventory release wins, and money received after the deadline is refunded in full and never confirms a booking.

## Status of earlier decisions

- **ADR 0087:** amended. Its card-only scope is replaced by this decision. Its provider choice and card mechanics stand.
- **ADR 0047:** unchanged. Paystack is its first certified provider once the certification tests below pass.
- **USSD (ADR 0048):** remains capability-gated.

## Activation

Bank transfer is switched on only after tests against Paystack's test mode cover:
- payment before expiry;
- payment after expiry;
- an incorrect amount;
- a duplicate payment;
- a delayed or duplicate event;
- a transfer in flight at the deadline (Payment-Processing Grace, ADR 0044).

These are the ADR 0047 certification cases.
