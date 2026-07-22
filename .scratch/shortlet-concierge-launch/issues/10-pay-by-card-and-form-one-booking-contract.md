# Pay by fresh card checkout and form one Booking Contract

Status: resolved
Type: task
User stories: 25, 29, 32–33

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Initialize one fresh PSP-hosted card checkout for the accepted offer, verify the resulting transaction server-side, atomically commit one Reservation, capture the Booking Contract snapshot, post initial ledger entries, and project confirmation without storing reusable payment credentials.

## Acceptance criteria

- [x] The platform handles no raw PAN, CVV, PIN, OTP, or reusable card token.
- [x] Confirmation requires independently verified booking, amount, currency, reference, payer, and unexpired inventory state.
- [x] Duplicate callbacks and command retries produce one Reservation, one contract snapshot, and balanced ledger effects.
- [x] Payment success appears in interaction state only after the authoritative transaction commits.

## Blocked by

- [Issue 09](09-issue-and-accept-a-conditional-booking-offer.md)

## Comments

- ADR Compliance: ADR 0002 (store checkout), ADR 0044 (20-min payment window + 10-min grace), ADR 0046 (one live payment attempt, idempotent callback/retry processing), ADR 0049 (fresh PSP checkout without raw credentials), ADR 0050 (risk-based card authentication & server-side verification), ADR 0072 (platform command envelope), ADR 0075 (data minimization and redaction of credentials).

## Answer

Implemented `CardPaymentManager` in `domains/shortlet/src/card-payment.ts` and unit tests in `test/pay-by-card-and-form-one-booking-contract.test.ts`. All acceptance criteria and failure paths are fully verified.

