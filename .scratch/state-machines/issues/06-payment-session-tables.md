# 06 Payment sessions: unions and transition tables

Status: ready-for-agent
Type: task
Track: B (no behaviour change)
Blocked by: 03

## What to build

Each machine below gets three exports:
- a `*_STATUSES` const array;
- a `*Status` type;
- a `*_TRANSITIONS` table, `satisfies TransitionTable<…>`, that lists exactly the moves the code makes today. Read every write site to confirm them.

| Machine | File | Today's moves to confirm |
|---|---|---|
| Card checkout session | `domains/shortlet/src/card-payment.ts` (`status: "initiated" \| "completed" \| "expired" \| "failed"`) | `initiated` → `completed`. `expired` and `failed` are never written (issue 25). |
| Bank transfer session | `domains/shortlet/src/bank-transfer.ts` | `initiated` → `processing_in_grace`, `completed`, `expired`. `processing_in_grace` → `completed`, `expired`. `expired`/`refunded`: read `#lateRefund` and `resolveExpiry`. |
| Manual transfer | `domains/shortlet/src/manual-transfer.ts` (`ManualTransferStatus`) | Read `#decidable`, `#expireIfDue` and `saveDecision`. |
| Live payment attempt | `domains/shortlet/src/payment-attempt.ts` (`LivePaymentAttemptStatus`) | `active` → `terminal`. |

Rules:
- **Keep exported names.** Where a name is already exported (`ManualTransferStatus`, `LivePaymentAttemptStatus`), keep it and add only the array and the table.
- **`resolveExpiry` deny-list.** The table must describe what the code does today. Today that admits `completed` → `expired`. Do not tighten it here; issue 17 does. List the move in the table with the comment `// issue 17: latent, tightened there`.
- **Store row mapper.** The mapper in `guest-interaction-store.ts` (issue 15's `checkoutSessionStatus`) should use the new card-session type.
- **No behaviour change.** Do not change any guard, error string or persistence.
- **Map.** Add the names in backticks to the map rows in `docs/agents/state-machines.md`.
- **Parallel work.** Another agent is changing journey-stage writes in the same two files (issue 07). Touch only session status lines and the new exports.

## Acceptance criteria

1. Characterisation: each session's main path (start, verify, expiry, late refund where it exists) ends in the same status as before.
2. Characterisation: a second checkout while one is `initiated` is still refused, and a decision on a non-decidable manual transfer is still refused, both with today's error text.
3. Every move the code makes is in its table, asserted with `canTransition`.
4. `npm run check` is clean.

## Tests

1. **Characterisation tests first.** Create `test/payment-session-transitions.test.ts`, reusing these helpers:
   - `test/helpers/guest-manual-transfer.ts`
   - `test/helpers/paystack-http.ts`
   - the existing bank-transfer and card-payment tests
2. **Re-run** every test whose name contains `card-payment`, `bank-transfer`, `manual-transfer`, `payment-attempt` or `card-session`, plus `test/state-machine-inventory.test.ts`.
3. **Then** run `npm run check`.

ADRs: 0044, 0045, 0046, 0047, 0090.

## Comments
