# Expire bank-transfer payment and refund late success

Status: resolved
Type: AFK
User stories: 26–28, 31–32

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Offer one booking-specific, amount-bound bank-transfer reference, enforce the 20-minute Payment Window plus one ten-minute processing grace, release inventory at 30 minutes, and route every later verified success into an automatic refund workflow without forming a Booking Contract.

## Acceptance criteria

- [x] Only one Live Payment Attempt and reference may exist for the offer.
- [x] Reference expiry, processing grace, inventory release, and late-success classification use server time and exact boundaries.
- [x] A late success creates refund and reconciliation records but no Reservation or Booking Contract.
- [x] Races among verification, expiry, release, duplicate callbacks, and Operator Blocks are tested with real transactions.

## Blocked by

- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
