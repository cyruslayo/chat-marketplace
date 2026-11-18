# 07 BookingPaymentJourney: stage table and one stage writer

Status: resolved
Type: task
Track: B (no behaviour change)
Blocked by: 03

## What to build

**Table.** In `domains/shortlet/src/booking-payment-journey.ts`, `BookingPaymentStage` has 13 stages. Export `BOOKING_PAYMENT_STAGES` and `BOOKING_PAYMENT_STAGE_TRANSITIONS` (`satisfies TransitionTable<BookingPaymentStage>`).

**Pairs.** Find every journey `stage:` write in `domains/shortlet/src/card-payment.ts` and `domains/shortlet/src/bank-transfer.ts`. Search `stage: "` and `journeys.update` / `#journeys`. For each write, work out the from-stage(s) it runs from. The table must contain every from→to pair the code can make today.
- When a write runs from "whatever the current stage is" (for example `#markPaymentProcessing`), list every from-stage that a test or flow actually reaches.
- Record that the write is unguarded in a code comment that names issue 17.

**One stage writer.** Route the stage writes in each manager through one small private helper per manager (for example `#setStage(value, to)`). It returns `{ ...value, stage: to }`.
- In production it must not throw or change behaviour.
- Where a write already has an explicit from-stage check (the one in `card-payment.ts` near line 588), keep that check exactly.

**Test-only check.** Add a check, used only by tests, that every recorded transition is in the table. Do it in the test with a spy or wrapper over the journey repository, not in production code.

**Out of scope.** Do not change `journeyVersion` compare-and-set, the component statuses or any error strings.

**Parallel work.** Another agent is changing session-status lines in the same two files (issue 06). Touch only journey `stage` writes and the new exports.

**Map.** Add the names in backticks to the journey row of `docs/agents/state-machines.md`.

## Acceptance criteria

1. Characterisation: the card stay-plus-deposit path and the bank-transfer path each produce the same sequence of stages as before.
2. Every stage move recorded across the existing card-payment and bank-transfer tests is in `BOOKING_PAYMENT_STAGE_TRANSITIONS`.
3. The table lists all 13 stages. The never-written `failed` and `expired` stages have empty lists and a comment pointing to issue 25.
4. `npm run check` is clean.

## Tests

1. **Write the characterisation tests first:** `test/payment-journey-stages.test.ts`. Reuse the existing journey, card-payment and bank-transfer fixtures; search `test/` for `BookingPaymentJourney` and `journeyStage`.
2. **Re-run:**
   - every test whose name contains `card-payment`, `bank-transfer`, `journey` or `deposit`
   - `test/deposit-processing-cold-restore.test.ts`
   - `test/state-machine-inventory.test.ts`
3. **Then** run `npm run check`.

ADRs: 0044, 0045, 0046, 0047.

## Comments
- Stage table: `BOOKING_PAYMENT_STAGES` (13) and `BOOKING_PAYMENT_STAGE_TRANSITIONS` (`satisfies TransitionTable<BookingPaymentStage>`) in `domains/shortlet/src/booking-payment-journey.ts`. `BookingPaymentStage` is now derived from the array (same 13 strings, same union). Map row updated in `docs/agents/state-machines.md`.
- Stage writer: `#setStage(value, to)` (private, returns `{ ...value, stage: to }`) in `CardPaymentManager` and in `BankTransferPaymentManager`. 9 writes each. Every write is annotated: unguarded (issue 17) or behind the existing from-stage check (issue 07, check unchanged: card `deposit_payment_active`/`stay_settled` check, bank the same, `both_settled` and `confirmed` if-guards). No error strings, `journeyVersion` CAS, or session status lines touched.
- Table, from -> allowed to: ready -> stay_payment_active; stay_payment_active -> stay_payment_active, stay_payment_processing, stay_settled, reconciliation_required; stay_payment_processing -> stay_payment_active, stay_payment_processing, stay_settled, reconciliation_required; stay_settled -> deposit_payment_active, both_settled, compensation_pending, compensated, reconciliation_required; deposit_payment_active -> stay_payment_active, deposit_payment_processing, both_settled, compensation_pending, compensated, reconciliation_required; deposit_payment_processing -> stay_payment_active, deposit_payment_processing, both_settled, compensation_pending, compensated, reconciliation_required; both_settled -> confirmed, compensation_pending, compensated, reconciliation_required; confirmed -> (none); compensation_pending -> compensation_pending, compensated, reconciliation_required; compensated -> compensation_pending, reconciliation_required; reconciliation_required -> compensation_pending, compensated, reconciliation_required; failed -> (none), expired -> (none) (never written, issue 25).
- From-lists for the unguarded writes are the stages the existing tests reach plus the named retry, processing and compensation flows. They are not a proof that every code-possible pair is listed. Issue 17 owns guarding them.
- Observed, not changed (Track B): a deposit checkout retried while the stage is `deposit_payment_active` or `deposit_payment_processing` takes purpose `stay` (purpose is `security_deposit` only when the stage is `stay_settled`), so the stage moves back to `stay_payment_active`. That pair is in the table. Owner to decide under issue 17.

Characterisation (`test/payment-journey-stages.test.ts`, helpers `test/helpers/payment-journey-stages.ts`):
- Before the refactor, `npx tsx --test test/payment-journey-stages.test.ts`: 2 tests, 2 pass, 0 fail (card stay-plus-deposit and bank-transfer sequences: ready -> stay_payment_active -> stay_settled -> deposit_payment_active -> both_settled -> confirmed, exact move list asserted). Run against the unchanged managers.
- Recording pass before the refactor, to find the moves the existing tests make: `NODE_OPTIONS` preloads a spy on `InMemoryBookingPaymentJourneyRepository.prototype.update` and `SqliteBookingPaymentJourneyRepository.prototype.update` (scratchpad, not committed), then `node node_modules/tsx/dist/cli.mjs --test` on the 60 journey-named files plus the new test: 407 tests, 397 pass, 10 fail. The 10 fails are in `back-office-bookings.test.ts` (owner back office, not touched here, flaky under load); that file passes solo, 3/3. 11 distinct moves were recorded; all 11 are in `BOOKING_PAYMENT_STAGE_TRANSITIONS` (checked after the table was written).

After the refactor:
- `npx tsx --test test/payment-journey-stages.test.ts`: 6 tests, 6 pass, 0 fail (the 2 characterisation tests unchanged, plus AC2 membership, a negative control for the check, AC3 13 stages, AC3 failed/expired empty).
- `npx tsx --test <60 journey-named files> test/payment-journey-stages.test.ts` (the `card-payment`, `bank-transfer`, `journey`, `deposit` name matches, `deposit-processing-cold-restore.test.ts`, `state-machine-inventory.test.ts`, the `grep` matches for journey fixtures, excluding real-browser `*chromium*` and `*real-browser*` files): 411 tests, 411 pass, 0 fail, about 320 s.
- `npx tsx --test test/state-machine-inventory.test.ts`: 4 tests, 4 pass, 0 fail.
- `npx tsx --test test/state-transition.test.ts` not re-run (predicate unchanged).
- `npm run check` (`tsc --noEmit`, apps/cloudflare, tsconfig.test, tsconfig.tooling, worker bundle guard): exit 0 on the worktree.
- Not run: full `npm test` and `npm run test:workers` (batch gate, AGENTS.md Test scope). No real-Chrome files run.

ADRs read: 0044, 0045, 0046, 0047 (`docs/adr/`). Constraint applied: the stage writes are unchanged, so payment window, grace, one live attempt and transfer expiry behave as before. Definition of Done: each AC has a named test (AC1 two tests, AC2 one test plus a negative control, AC3 two tests, AC4 `npm run check`); failure path covered by the negative control; no injected dependency added; no policy strings or constants added; no credentials or ids added to audit or logs; `npm run check` clean. Full `npm test` is the batch gate.

Not confirmed: the test-only `offer` fixture is copied into `test/helpers/payment-journey-stages.ts` rather than imported from the existing test files (they do not export it). The AC2 test reads moves committed by the two characterisation tests above it (module-level collector), so it depends on the file order.

- Orchestrator review: every stage write now goes through `#setStage`; the existing from-checks are unchanged. Re-ran the card, bank-transfer, journey and deposit-restore files and `npm run check` (exit 0). Follow-up after merge: point `test/helpers/payment-journey-stages.ts` at the shared offer fixture from issue 05.
- Test-helper dedup (no code change): `test/helpers/payment-journey-stages.ts` has no unit repository, request manager, offer manager, verification or operator setup, and `test/helpers/conditional-offer-issue.ts` has no `createConditionalOfferFixture` (not in the worktree, and `git log --all -S createConditionalOfferFixture -- test/` is empty). The only overlap is the hand-built `stageOffer` literal, which the test bodies depend on, so nothing was replaced. `npx tsx --test test/payment-journey-stages.test.ts test/offer-reservation-transitions.test.ts test/issue-and-accept-conditional-booking-offer.test.ts`: 17 tests, 17 pass, 0 fail. `npm run check` exits 1 at HEAD: `domains/shortlet/src/card-payment.ts` imports `TransitionTable` twice (lines 2 and 11, TS2300). Not changed here; owner decision.
