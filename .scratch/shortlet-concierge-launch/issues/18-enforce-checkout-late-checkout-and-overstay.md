# Enforce checkout, Late Checkout, and overstay rules

Status: ready-for-agent
Type: AFK
User stories: 38–40, 47

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Enforce 11:00 AM WAT Contractual Checkout, offer only eligible fixed-increment Late Checkout through 2:00 PM, prohibit it for any same-day incoming Reservation, and open a standardized unauthorized-overstay incident after the authoritative deadline.

## Acceptance criteria

- [ ] Eligibility checks same-day arrivals, maintenance/inspection needs, turnover capacity, support availability, Operator decision, price, and guest acceptance.
- [ ] Approved amendment time drives reminders, access expiry, turnover start, overstay, support, and deposit-claim deadlines.
- [ ] No informal message, cash, or direct transfer can extend checkout or create a charge.
- [ ] Overstay consequences are standardized, evidence-backed, non-duplicative, and subject to human safety escalation.

## Blocked by

- [Issue 16](16-verify-access-with-live-support.md)
