# A cancelled Reservation accepts no change

Status: ready-for-agent
Type: task
Blocked by: 03 (D3 accepted 25 Nov 2026)

## Defect (latent: neither flow is connected for guests)

`BookingAmendmentManager` checks the contract version, calendar, inspection, authority and quote. It never reads the Reservation. Cancelling moves the Reservation without moving the contract version. So an accepted amendment can settle and commit after cancellation (rules 01 S1, trial A).

## What to build (D3)

- Give `BookingAmendmentDependencies` a required Reservation reader. Request, accept and commit refuse unless the Reservation is `confirmed`. A missing Reservation refuses (fail closed).
- Re-read it immediately before `settlementProvider.settle`, and again before the contract write.
- Cancellation closes a `proposed`, `accepted` or unpaid `awaiting_financial_settlement` amendment. Add the move to `AMENDMENT_TRANSITIONS` only if the owner names the state (no invented status).
- In-flight settlement (D3): a payment already in progress settles first and is then refunded with the stay. The refund half needs issue 05; until it lands, cancellation refuses while a settlement is in flight, with a message that says why, rather than losing the money.
- **Stop and ask** if a needed state or message has no source. The closed-by-cancellation state has no name yet.

## Acceptance criteria

- AC1: After cancellation, request, accept and commit are refused, nothing is collected and the contract version does not move. Failure paths: `no_show`, a missing Reservation, another guest's Reservation.
- AC2: The order check of issue 03 reports zero failing orders, with cancel and commit each succeeding in at least one order.
- AC3: Removing the new guard makes AC2 fail again (recorded in Comments).
- AC4: An amendment with no cancellation behaves as before (`test/amend-material-booking-terms.test.ts` keeps its assertions).
- AC5: `docs/agents/state-machines.md` names the guard.

## ADR compliance

0045, 0058, 0060, 0072, 0074.

## Comments
