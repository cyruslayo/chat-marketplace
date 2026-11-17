# 11 A deposit payment in processing restores as processing

Status: ready-for-agent
Type: task
Track: C
Blocked by: none

## Defect

**Where:** the payment restore branch of `#restoreCurrentSurface` in `apps/local-guest/src/shortlet-app.ts`, near line 3289.

**What it does:** it treats a restored card payment as processing only when `artifact.facts.journeyStage === "stay_payment_processing"`. These other places also accept `"deposit_payment_processing"`:
- the surface renderer, near line 6405;
- `apps/local-guest/src/guest-server.ts`, near line 4276;
- `isCardPaymentProcessing` in `apps/web-agent/src/payment-presentation.ts`.

**Effect:** after a cold restore, a guest whose security-deposit payment is being checked is shown the wrong payment surface instead of the processing one.

## Fix

Replace the inline check with `isCardPaymentProcessing(artifact.facts)`, imported from `apps/web-agent/src/payment-presentation.ts`. Change nothing else.

## Acceptance criteria

1. After a cold restore, a thread whose card payment is in `deposit_payment_processing` restores to the payment processing (result) surface, as a `stay_payment_processing` thread does.
2. A thread in `stay_payment_processing` restores exactly as before.
3. A thread whose payment is `ready` (not processing) still restores to the payment-ready surface.

## Tests

- **Add** `test/deposit-processing-cold-restore.test.ts`.
  - Look for an existing deposit or processing fixture first: search `test/` and `test/helpers/` for `deposit_payment_processing` and `stay_payment_processing`.
  - Restore with a new `LocalGuestApp` over the same store (ADR 0106).
- **Re-run** `test/guest-process-restart.test.ts`, `test/assistant-cold-journey.test.ts`, and any test that matches `payment` together with `restart` or `restore`.
- **Finish with** `npm run check`.

ADRs: 0044, 0074, 0106.

## Comments
