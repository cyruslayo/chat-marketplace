# Accept manual bank transfer, verified against the credit

## Context

Many Nigerian guests prefer to pay a business directly by bank transfer. ADR 0088 offers card and Paystack transfer, both confirmed automatically by the provider.

The platform owner also wants guests to be able to pay into the business account and upload the transfer receipt. Transfer receipts are easy to fake or reuse, which is why ADR 0044 excludes screenshots and guest claims, and ADR 0047 allows only provider-verified expiring transfers. A manual method is therefore safe only if the money, not the receipt, confirms the booking.

## Decision

Manual bank transfer is a third payment option, shown after card and Paystack transfer. These rules apply to this method only.

### Offering it

- Guests pay into **one fixed business account**. Its bank name, account name and number are configuration, not code.
- Every booking has a **unique booking reference**, which the Guest must include with the transfer, and an exact NGN amount.
- The option is offered only when its whole timeline fits inside 8:00 AM–8:00 PM WAT: the 20-minute Payment Window plus the 60-minute verification hold.

### Timeline

1. The Guest transfers and uploads one receipt within the **20-minute Payment Window** (ADR 0044).
2. With no receipt by the deadline, the attempt expires and inventory releases, as for any method.
3. Once a receipt is uploaded, the dates stay held as Payment Pending for up to **60 minutes after the Payment Window deadline** while the platform checks its bank account. This hold replaces ADR 0044's Payment-Processing Grace for this method only.
4. If not verified by then, the attempt expires and inventory releases. Money received for it is refunded in full (ADR 0045).

### Confirmation

A booking confirms only when an authorized back-office user verifies a matching credit in the business account and records:
- the bank transaction reference;
- the amount received.

The amount must equal the booking amount exactly. A bank transaction reference can confirm at most one booking. The receipt is evidence for finding the credit; it never confirms anything by itself.

**Rejection** is for money that didn't arrive or doesn't match. It releases the dates, tells the Guest that no Reservation was made, and refunds anything received in full.

### One live attempt

Choosing manual transfer takes the booking's single Live Payment Attempt (ADR 0046). The Guest can't switch to another method until this attempt has expired or been rejected.

### Receipts

- **Accepted files:** images or PDF within a configured size limit.
- **Storage:** outside the web root, viewable only by a signed-in back-office user with a grant for that owner.
- **Never** logged or sent to telemetry (ADR 0075).
- **Deletion:** 90 days after the stay's checkout, or 90 days after the attempt for a booking that never formed.

## Status of earlier decisions

- **ADR 0044:** amended for this method only. The 60-minute verification hold replaces the 10-minute Payment-Processing Grace, so the total inventory hold is at most 80 minutes.
- **ADR 0047:** unchanged for provider transfers. Manual transfer is a separate method governed by this decision.
- **ADR 0088:** extended. Manual transfer is a third option alongside card and Paystack transfer.

## Consequences

- Manual transfers add work for the back office: the platform owner must verify each one within the hold. The back office lists them by deadline.
- Reconciliation is manual. Each credit is recorded against exactly one booking.
