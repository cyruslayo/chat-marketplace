# Pay by fresh card checkout and form one Booking Contract

Status: ready-for-agent
Type: AFK
User stories: 25, 29, 32–33

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Initialize one fresh PSP-hosted card checkout for the accepted offer, verify the resulting transaction server-side, atomically commit one Reservation, capture the Booking Contract snapshot, post initial ledger entries, and project confirmation without storing reusable payment credentials.

## Acceptance criteria

- [ ] The platform handles no raw PAN, CVV, PIN, OTP, or reusable card token.
- [ ] Confirmation requires independently verified booking, amount, currency, reference, payer, and unexpired inventory state.
- [ ] Duplicate callbacks and command retries produce one Reservation, one contract snapshot, and balanced ledger effects.
- [ ] Payment success appears in interaction state only after the authoritative transaction commits.

## Blocked by

- [Issue 09](09-issue-and-accept-a-conditional-booking-offer.md)
