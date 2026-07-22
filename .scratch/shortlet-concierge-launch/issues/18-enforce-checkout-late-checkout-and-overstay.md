# Enforce checkout, Late Checkout, and overstay rules

Status: resolved
Type: AFK
User stories: 38–40, 47

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Enforce 11:00 AM WAT Contractual Checkout, offer only eligible fixed-increment Late Checkout through 2:00 PM, prohibit it for any same-day incoming Reservation, and open a standardized unauthorized-overstay incident after the authoritative deadline.

## Acceptance criteria

- [x] Eligibility checks same-day arrivals, maintenance/inspection needs, turnover capacity, support availability, Operator decision, price, and guest acceptance.
- [x] Approved amendment time drives reminders, access expiry, turnover start, overstay, support, and deposit-claim deadlines.
- [x] No informal message, cash, or direct transfer can extend checkout or create a charge.
- [x] Overstay consequences are standardized, evidence-backed, non-duplicative, and subject to human safety escalation.

## Blocked by

- [Issue 16](16-verify-access-with-live-support.md)

## Answer

Implemented `CheckoutOverstayManager` in `domains/shortlet/src/checkout-overstay.ts`.

### ADR Compliance
- **ADR 0032**: Contractual Checkout fixed at 11:00 AM WAT; deposit-claim deadlines, access expiry, turnover start driven by authoritative checkout timestamp.
- **ADR 0033**: Late Checkout capped at 14:00 WAT (increments: 12:00, 13:00, 14:00 WAT); prohibited if same-day arrival exists.
- **ADR 0034**: Same-day incoming reservation prohibits Late Checkout.
- **ADR 0060**: Informal messages, cash, or direct bank transfer cannot extend checkout or create charges; versioned amendments required.

