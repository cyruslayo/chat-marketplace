# 06 Payment sessions: unions and transition tables

Status: resolved
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

Agent run, Track B (no behaviour change). Branch feat/state-machines-06. Not committed (orchestrator reviews).

**ADRs read and applied (protocol step 2)**

| ADR | Constraint | Where it lands |
|---|---|---|
| 0044 | Payment Window 20 min plus one 10 min processing grace; no new reference after the deadline | Bank table: `processing_in_grace` only from a pending verify before the deadline; the card path is unchanged |
| 0045 | Every late success is refunded in full, never confirms | Bank table: `expired -> refunded` and `initiated/processing_in_grace -> refunded` (`#lateRefund`) |
| 0046 | One live payment attempt per offer; release is the terminal move | Live attempt table: `active -> terminal`; card table: second checkout while `initiated` is refused |
| 0047 | Bank transfer expires at the deadline; resolveExpiry is the expiry route | Bank table: `initiated/processing_in_grace -> expired` |
| 0090 | Manual transfer: receipt upload, 60 min verification hold, decisions only while awaiting verification | Manual table: upload, the two deadlines, `#decidable` guards the decisions |

**Tables written** (each exported next to its status type; `satisfies TransitionTable<...>`, `canTransition` from `packages/platform-core/src/state-transition.ts`)

- `CARD_CHECKOUT_SESSION_STATUSES` / `CardCheckoutSessionStatus` / `CARD_CHECKOUT_SESSION_TRANSITIONS` (`card-payment.ts`): `initiated -> completed`. `expired` and `failed` have no writes (issue 25).
- `BANK_TRANSFER_SESSION_STATUSES` / `BankTransferSessionStatus` / `BANK_TRANSFER_SESSION_TRANSITIONS` (`bank-transfer.ts`): `initiated` to `processing_in_grace`, `completed`, `expired`, `refunded`; `processing_in_grace` to itself (a repeated pending verify), `completed`, `expired`, `refunded`; `completed -> expired` marked `// issue 17: latent, tightened there`; `expired -> refunded`; `refunded` terminal.
- `MANUAL_TRANSFER_STATUSES` / `ManualTransferStatus` (now derived from the array) / `MANUAL_TRANSFER_TRANSITIONS` (`manual-transfer.ts`): `awaiting_receipt` to `awaiting_verification`, `expired`; `awaiting_verification` to `confirmed`, `rejected`, `expired`; the three terminal states are empty.
- `LIVE_PAYMENT_ATTEMPT_STATUSES` / `LivePaymentAttemptStatus` (derived) / `LIVE_PAYMENT_ATTEMPT_TRANSITIONS` (`payment-attempt.ts`): `active -> terminal`.

Creation (start: `initiated`, `awaiting_receipt`, an acquired attempt as `active`) is noted in each table comment and is not a move.

**Other edits.** `guest-interaction-store.ts`: `DurableCardCheckoutSession.status` and `checkoutSessionStatus` now use `CardCheckoutSessionStatus` (type-only import, the four literal checks unchanged). `bank-transfer.ts`: a comment on the `resolveExpiry` deny-list marking the issue 17 latent move (no code change). Status unions replaced by `typeof ARRAY[number]` types with the same members, so persisted strings are unchanged. Map rows in `docs/agents/state-machines.md` now name the new exports.

**Commands** (all from `C:\AI2026\chat-marketplace-sm-06`, each prefixed `env -u LLM_API_KEY`)

1. Characterisation written first, against the unchanged code: `npx tsx --test test/payment-session-transitions.test.ts`. Green run before refactor: **12 of 12 pass, 0 fail** (AC1 x9, AC2 x3). Output: `.../scratchpad/phaseA-run.txt`.
2. Refactor, then AC3 tests appended (AC1 and AC2 bodies unchanged; the diff against the pre-refactor copy only adds imports and the AC3 block).
3. `npm run check` (`tsc --noEmit`): **exit 0**.
4. Named test set in one command: `npx tsx --test test/payment-session-transitions.test.ts test/state-transition.test.ts test/state-machine-inventory.test.ts test/card-session-status-row.test.ts test/integrate-bank-transfer-application.test.ts test/integrate-card-payment-application.test.ts test/render-bank-transfer-weaver-a2ui.test.ts test/render-card-payment-weaver-a2ui.test.ts test/manual-transfer-with-receipt.test.ts test/back-office-manual-transfers.test.ts`. **39 tests, 39 pass, 0 fail, 2 suites.** This covers the inventory ratchet (the inventory ratchet tests pass). The new file contributes 14 (12 characterisation, 2 AC3).

Excluded on purpose: `test/manual-transfer-copy-chromium.test.ts` (real Chrome, this issue does not change that screen). No test filename contains `payment-attempt`.

**Acceptance criteria**

- AC1 (characterisation of main paths): met by 9 tests named `AC1: ...`. Card: start and verify end `completed` (a provider-rejected verify leaves `initiated`). Bank: confirmed, processing grace, expiry at the grace end (repeat returns the same), late payment from `initiated` and from `expired` ends `refunded`. Manual: start and receipt upload end `awaiting_verification`; both deadlines end `expired`. Live attempt: acquire and release end `terminal`.
  - Card has no late refund path, so there is no card refund test.
  - Manual `awaiting_verification -> confirmed` is not driven from the guest environment (`Booking confirmation is not composed`). It is covered by `back-office-manual-transfers.test.ts` AC2 (passes in the named run).
  - The latent `completed -> expired` move is in the table, not pinned by a test, so issue 17 can change it without rewriting a characterisation.
- AC2 (refusals with today's text): met by three tests. A second card checkout while `initiated` is refused with "A live checkout already exists for this offer". A decision on `awaiting_receipt` is refused with "The Guest has not uploaded a receipt yet". A decision on `expired` is refused with "This transfer expired before it was verified; any money received is refunded in full".
- AC3 (every move in its table, via `canTransition`): met by two tests. The first asserts each observed move is `true`. The second asserts non-moves are `false`, including `refunded -> completed`, `expired -> completed`, `awaiting_receipt -> confirmed` and `terminal -> active`.
- AC4 (`npm run check` clean): exit 0.

**Definition of Done**

1. Dedicated named test per AC, names mirror the criterion text: yes. The AC1 and AC2 tests are prefixed with their criterion; AC3 has its own describe block.
2. Failure paths asserted (refusals and non-moves): yes (AC2, and the negative half of AC3).
3. ADRs listed and read: 0044, 0045, 0046, 0047, 0090 (table above).
4. No unused injected dependency: no new class or constructor parameter.
5. No invented policy string: tables are read from write sites; the error strings are unchanged.
6. No bearer credential in logs or audit: nothing added. The tokens and references in the test are fixture values only.
7. `npm run check` passes. The full `npm test` is the once-per-batch gate (AGENTS.md Test scope) and has **not** been run here, as instructed.

**Unconfirmed / open**

- The full `npm test` and `npm run test:workers` are not run; they belong to the batch gate.
- The guest-side `confirm` gap above: a manual transfer cannot be driven to `confirmed` from the guest environment alone. Not a defect of this issue, but it limits what AC1 can cover directly.
- The map row for card sessions still says "Unknown row status loads as initiated (issue 15)". Issue 15 already fails closed, so that gap text is stale. Not changed here (out of scope).
- Orchestrator review: types-only diff read; re-ran the 10 files (39 pass) and `npm run check` (exit 0). Corrected the map's stale card-session gap (issue 15 is fixed).
