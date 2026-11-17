# 09 Exhaustive status copy in web-agent presentation

Status: ready-for-agent
Type: task
Track: B (no behaviour change)
Blocked by: 01

## What to build

Several mappers in `apps/web-agent/src/` turn a status into guest copy with ternary chains or `if` ladders that end in a catch-all. Make them exhaustive at compile time without changing a single output string.

- **`guestPaymentStatus` (`booking-presentation.ts`).**
  - Today the final `return` ("Booking confirmed") is reached only by `confirmed`, because every other `CardPaymentStatus` member (`apps/web/src/card-payment-artifact.ts`) is handled above it.
  - Rewrite it as a `satisfies Record<CardPaymentStatus, …>` lookup, keeping the `processing` variant for `checkout_initiated`. This is the precedent pattern in `apps/local-guest/src/landing-photos.ts`.
  - The output for every status, with `processing` true and false, must stay byte-identical.
  - A runtime value outside the type is issue 12; keep today's result for it here (the confirmed copy), and lock that with a test.
- **`offerScreenContent` (`offer-presentation.ts`).** Map each offer status to its screen `state` with a `satisfies Record<…>`. Today `stale` and `revoked` fall to `"closed"`; keep that.
- **`cardPaymentCopy` (`payment-presentation.ts`) and `guestRequestStatus` (`booking-presentation.ts`).** Convert only where the input is a closed union.
  - `guestRequestStatus` takes `status: string`. Leave its signature alone unless issue 04's `BookingRequestStatus` already exists on this branch (it does not yet), and say which you did.

Do not edit or invent any copy. Strings must come out exactly as they are now.

## Acceptance criteria

1. Characterisation: for every member of `CardPaymentStatus`, with `processing` true and false, `guestPaymentStatus` returns the same label, detail and progress as before. Capture the "before" values in the test from the current code, before you refactor.
2. Characterisation: `offerScreenContent`'s `state` is the same as before for every offer status.
3. Adding a member to `CardPaymentStatus` without copy fails `npm run check`. Prove it with an `@ts-expect-error` on a partial record in the test.
4. `npm run check` is clean.

## Tests

- New test: `test/presentation-copy-exhaustive.test.ts`.
- Re-run every test whose name contains `payment-presentation`, `offer-presentation`, `booking-presentation`, `guest-offer` or `guest-payment`, plus `test/state-machine-inventory.test.ts`.
- Run `npm run check`.

ADRs: 0074; UX guidelines §9-10 (`docs/design/shortlet-ux-guidelines.md`) for copy (unchanged here).

## Comments
