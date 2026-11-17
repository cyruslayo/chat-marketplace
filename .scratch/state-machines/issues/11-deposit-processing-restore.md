# 11 A deposit payment in processing restores as processing

Status: resolved
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

- Agent (Haiku 5.5), branch feat/state-machines-11, uncommitted (orchestrator commits).
- Before the fix: `env -u LLM_API_KEY npx tsx --test test/deposit-processing-cold-restore.test.ts` gave AC1 failing: after a cold restore the surface was `thread-...:payment:ready:offer-...` (wrong surface), with the card payment at `deposit_payment_processing` confirmed before restart. AC2 and AC3 passed.
- Fix: `#restoreCurrentSurface` in `apps/local-guest/src/shortlet-app.ts` now uses `isCardPaymentProcessing(artifact.facts)` (imported from `apps/web-agent/src/payment-presentation.ts`) in place of the `stay_payment_processing` literal. Nothing else changed.
- Fixture: a guest-driven deposit reaches processing with a `:payment:result:` surface id, which the bug does not affect (verified: that path passed before the fix). The test therefore puts the thread on the deposit checkout surface and runs the server-side return verification (`cardPaymentApp.verifyAndConfirm`, the same call the payment return route makes) while the stay settles on the first verification. The stay verification needs `payerId` matching the guest (ADR 0044 payer check), so the fixture uses `guestId` `guest-demo-101`. No casts.
- Commands: `env -u LLM_API_KEY npx tsx --test test/deposit-processing-cold-restore.test.ts test/guest-process-restart.test.ts test/assistant-cold-journey.test.ts` gives tests 30, pass 30, fail 0.
- `env -u LLM_API_KEY npm run check` exits 0 (after typing the two optional `summary` asserts in the new test).
- Not run, per instruction: `npm test` (full suite) and real-Chrome files.
- ADRs read and applied: 0044 (processing grace, payer check), 0074 (restore must reflect the server state), 0106 (cold restore via new LocalGuestApp over the same store). The no-cast rule is met.
- Definition of Done: items 1, 2, 3, 4, 5 and 6 hold (no new classes, no new policy values). Item 7 requires `npm test` to pass, and it has not been run, so Status stays `ready-for-agent`; the orchestrator should set `resolved` after the pre-merge gate.
- Observed, not changed (out of scope): `#paymentSurface` gives different summaries for the same processing surface ("Payment processing" on the response, "Checking payment" on restore). The same stale check at the surface renderer (`shortlet-app.ts` near line 6405) and `apps/local-guest/src/guest-server.ts` near line 4276 still spell out both stage literals, which is equivalent and left as is.
- Orchestrator review: one-line fix read; re-ran the 3 files (30 pass) and `npm run check` (exit 0). Deviation recorded: the new test uses the non-assistant restore path with the restart-fixture clock; the restore branch is shell code shared by both paths, and `assistant-cold-journey.test.ts` passes. Resolved; full `npm test` is the batch gate.
