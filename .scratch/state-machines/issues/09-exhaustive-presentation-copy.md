# 09 Exhaustive status copy in web-agent presentation

Status: resolved
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

- Characterisation first (Track B, unchanged code): `test/presentation-copy-exhaustive.test.ts` written with the current outputs hard-coded (guestPaymentStatus for all 9 CardPaymentStatus values with processing true and false, cardPaymentCopy for each status with and without the processing stage, offerScreenContent state for all 5 offer statuses).
- Pre-refactor green run: `env -u LLM_API_KEY npx tsx --test test/presentation-copy-exhaustive.test.ts` gave 4 of 4 pass. The named set `npx tsx --test test/guest-offer-access.test.ts test/guest-offer-consistency.test.ts test/guest-offer-payment-clarity.test.ts test/guest-payment-choice.test.ts test/guest-payment-consistency.test.ts test/state-machine-inventory.test.ts test/presentation-copy-exhaustive.test.ts` gave 36 of 36 pass before the refactor.
- Refactor: `guestPaymentStatus` is a `GUEST_PAYMENT_STATUS_COPY` map with `satisfies Record<CardPaymentStatus, GuestPaymentCopy | GuestCheckoutCopy>` (`checkout_initiated` splits on processing). `offerScreenContent` uses `OFFER_SCREEN_STATE` with `satisfies Record<offer status, state>`. `cardPaymentCopy` title and status pill are maps; its content ternary is unchanged because it composes the guest detail text. Runtime fallbacks kept: confirmed copy for `guestPaymentStatus`, `closed` for offers.
- `guestRequestStatus` is unchanged. It takes `status: string`, and `BookingRequestStatus` (issue 04) does not exist on this branch.
- First `npm run check` failed with TS2308: `GUEST_PAYMENT_COPY` collides with the export of the same name in `guest-content.ts` through `apps/web-agent/src/index.ts`. Renamed the map to `GUEST_PAYMENT_STATUS_COPY`; no output changed.
- Post-refactor: `npm run check` exit 0 (`tsc --noEmit`, cloudflare, cloudflare tests and tooling configs, and `check-worker-bundle`). Same named set: 37 of 37 pass, with the AC3 test added. The 4 characterisation tests were unchanged apart from the rename.
- Not run: real-Chrome files (`guest-offer-consistency-chromium`, `guest-offer-payment-clarity-chromium`, `guest-payment-consistency-chromium`) and the full `npm test` (batch gate). ADRs read: 0074 (fail closed); the payment-status and offer copy is governed by 0044 and 0046 but no copy was changed.
- Review fix: `cardPaymentCopy` title now falls back with `?? "Payment status"`, so a runtime status outside `CardPaymentStatus` keeps the old title. Its status pill still falls back to the guest payment label ("Booking confirmed"). New characterisation test: "a runtime status outside CardPaymentStatus keeps today's cardPaymentCopy title and status pill".
- Re-run: the 7-file set `npx tsx --test test/guest-offer-access.test.ts test/guest-offer-consistency.test.ts test/guest-offer-payment-clarity.test.ts test/guest-payment-choice.test.ts test/guest-payment-consistency.test.ts test/state-machine-inventory.test.ts test/presentation-copy-exhaustive.test.ts` gave 38 of 38 pass.
- Re-run: `npm run check` exit 0, zero `error TS` lines.
- Orchestrator review: equivalence of every mapper checked by reading; re-ran the 7 files (38 pass) and `npm run check` (exit 0).
