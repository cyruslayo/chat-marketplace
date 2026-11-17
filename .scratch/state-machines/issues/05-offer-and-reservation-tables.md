# 05 ConditionalOffer and Reservation: unions and transition tables

Status: ready-for-agent
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
