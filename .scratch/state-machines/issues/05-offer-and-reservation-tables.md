# 05 ConditionalOffer and Reservation: unions and transition tables

Status: resolved
Type: task
Track: B (no behaviour change)
Blocked by: 03

## What to build

**ConditionalOffer** (`domains/shortlet/src/conditional-offer.ts`; the inline union `status: "issued" | "accepted" | "expired" | "stale" | "revoked"`):
- Export `CONDITIONAL_OFFER_STATUSES` and `ConditionalOfferStatus`, and use that type for the field.
- Export `CONDITIONAL_OFFER_TRANSITIONS` as `satisfies TransitionTable<ConditionalOfferStatus>`, encoding today's moves: `issued` → `accepted`, `expired`, `stale`. The other states are terminal; `revoked` is never written (issue 25).
- Read the accept path and the restore path to confirm these moves.

**Reservation** (`domains/shortlet/src/card-payment.ts`; `status: "confirmed" | "cancelled" | "no_show"`):
- Export `RESERVATION_STATUSES`, `ReservationStatus` and `RESERVATION_TRANSITIONS`: `confirmed` → `cancelled`, `no_show`. The other states are terminal.
- In `domains/shortlet/src/booking-state.ts`, type the `transitionReservationStatus` parameters with `ReservationStatus`, in both repositories.
  - Keep `expectedStatus` narrowed as it is today: `"confirmed"` only.
  - Keep the existing `STALE_ACTION` throw.
  - Only if the current guard rejects exactly the same set, add `canTransition` next to it, keeping the throw.
- Leave `cancellation-noshow.ts`'s `"no_show_confirmed"` alone. Note it in the map as glossary drift.

**Both machines:**
- Do not change any accept guard, error string or persistence. The stale persistence from issue 13 stays as it is.
- Add the new names in backticks to the map rows in `docs/agents/state-machines.md`.

## Acceptance criteria

1. Characterisation: accepting an `issued` offer gives `accepted`. Accepting an `accepted`, `expired` or `stale` offer is refused with today's error text.
2. Characterisation: cancelling or no-showing a `confirmed` Reservation works. Doing either from `cancelled` or `no_show` throws `STALE_ACTION`.
3. Every move the code makes is in the matching table, asserted with `canTransition`.
4. `npm run check` is clean, and no write site uses a raw status literal outside the union type.

## Tests

1. **Characterisation tests first:** `test/offer-reservation-transitions.test.ts`. Reuse existing fixtures from `test/issue-and-accept-conditional-booking-offer.test.ts` and the cancellation tests (search `test/` for `transitionReservationStatus`).
2. **Re-run:**
   - every test whose name contains `conditional-offer` or `cancel`
   - `test/offer-restore-status.test.ts`
   - `test/state-machine-inventory.test.ts`
3. **Then** `npm run check`.

ADRs: 0044, 0074, 0086.

## Comments

**Pre-refactor green run (unchanged code, characterisation tests only):** `npx tsx --test test/offer-reservation-transitions.test.ts` gave 4 of 4 pass (AC1 issued accept; AC1 accepted/expired/stale refused; AC2 confirmed cancel/no-show; AC2 cancelled/no_show throw STALE_ACTION). AC3 (canTransition) was added after the tables existed.

**Refactor:** `CONDITIONAL_OFFER_STATUSES` / `ConditionalOfferStatus` / `CONDITIONAL_OFFER_TRANSITIONS` (conditional-offer.ts); `RESERVATION_STATUSES` / `ReservationStatus` / `RESERVATION_TRANSITIONS` (card-payment.ts); `transitionReservationStatus` `nextStatus` typed `ReservationStatus` in both repositories (booking-state.ts). The accept guard, error strings, persistence and the STALE_ACTION throw are unchanged. `canTransition` was NOT added to the Reservation guard: widening `nextStatus` to `ReservationStatus` means the guard would reject a different set (confirmed to confirmed), so the issue's "only if identical" condition is not met. Moves are asserted with `canTransition` in the test instead.

**ADRs read:** 0044 (Payment Window), 0074 (fail-closed surface lifecycle), 0086 (confirmation token digests). No constraint changes behaviour; the tables encode the current moves only.

**Commands and counts:**
- `npx tsx --test test/offer-reservation-transitions.test.ts` (pre-refactor, AC1 and AC2 tests): 4 pass.
- Final run, one command, 13 files: `npx tsx --test test/offer-reservation-transitions.test.ts test/state-machine-inventory.test.ts test/offer-restore-status.test.ts test/state-transition.test.ts test/conditional-offer-token-restore.test.ts test/integrate-conditional-offer-application.test.ts test/issue-and-accept-conditional-booking-offer.test.ts test/render-conditional-offer-weaver-a2ui.test.ts test/cancel-and-determine-no-show.test.ts test/demo-extended-cancellation-notice.test.ts test/guest-turn-cancel.test.ts test/integrate-cancellation-application.test.ts test/render-cancellation-weaver-a2ui.test.ts`: 80 pass, 0 fail.
- `npm run check`: exit 0 (includes the apps/cloudflare tsconfigs and the worker bundle guard).
- Real-Chrome `test/guest-turn-cancel-chromium.test.ts` matched "cancel" and was not run (real-Chrome rule).

**Definition of Done:** (1) each AC has its own named test; (2) failure paths asserted (error texts, STALE_ACTION); (3) ADRs listed above; (4) no new injected dependencies; (5) no new policy strings; (6) no credentials in logs; (7) `npm run check` passes; the full `npm test` is deferred to the batch gate per AGENTS.md Test scope.

**Review revision (coordinator):**
1. Reservation `transitionReservationStatus` `nextStatus` is now `Exclude<ReservationStatus, "confirmed">` in the interface and both repositories. Both guards are `!current || current.status !== expectedStatus || !canTransition(RESERVATION_TRANSITIONS, current.status, nextStatus)` with the same `STALE_ACTION` throw. Short-circuit order means `canTransition` only runs when `current.status` is "confirmed".
2. Shared fixture: `setup()` and `createConfirmedRequest()` moved verbatim from `test/issue-and-accept-conditional-booking-offer.test.ts` into `test/helpers/conditional-offer-issue.ts` (exported, plus `issueConditionalOffer` and `acceptEnvelopeFor`). The existing test imports them; its test bodies and assertions are unchanged. The characterisation test imports the same helper.

**Revised counts:** `npm run check` exit 0 (all tsconfigs and the worker bundle guard). `npx tsx --test` on the same 13 files (command above): 80 pass, 0 fail. The pre-refactor 4-test run was before the revision.

**Notes:** the map rows for ConditionalOffer and Reservation name the new exports, and the `no_show_confirmed` glossary drift is noted there.
- Orchestrator review: both fixes read (exit type is Exclude<…, "confirmed">, so canTransition rejects exactly what the old guard did; one shared offer fixture). Re-ran the 13 files (80 pass) and `npm run check` (exit 0).
