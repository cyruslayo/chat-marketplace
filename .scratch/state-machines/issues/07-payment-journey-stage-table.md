# 07 BookingPaymentJourney: stage table and one stage writer

Status: ready-for-agent
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
