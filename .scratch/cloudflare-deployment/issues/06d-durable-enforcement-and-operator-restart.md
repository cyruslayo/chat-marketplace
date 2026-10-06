# Durable enforcement and owner booking state; operator restart test

Status: resolved
Type: task
Blocked by: 04b, 06a, 06b, 06c
Branch: `infra/cf-06d-operator-restart`
Requested: 2 Oct 2026
Unlocks: 15

## Why

This finishes the owner side's durability. Two pieces still live only in memory:
- `OperatorEnforcementManager` (`domains/shortlet/src/operator-enforcement.ts:132`, created at `local-owner-environment.ts:442`);
- `InMemoryBookingStateRepository` (:471).

`#demoRequests` (:420, used at :666 and :1496) is demo-only state that must never be relied on in production. The guest side already has a restart test (`test/guest-process-restart.test.ts`); the owner side needs the same proof.

## What to build

- Audit `OperatorEnforcementManager` the same way 06c did: record its state in `## Comments`, then persist what cannot be re-derived, on the shared handle, keeping its API.
- The owner environment uses `SqliteBookingStateRepository` (already present in `booking-state.ts:86`) on the shared handle, instead of `InMemoryBookingStateRepository`. First check whether the guest and owner sides must see the **same** booking-state rows. If so, confirm they share one table, and record that.
- `#demoRequests`: make sure it is only populated in non-production configurations (`production: false`). Production must neither read nor write it.
- `test/operator-process-restart.test.ts`: provision an operator, log in, act on a request, record revenue, and apply an enforcement step. Then close the environment and server, reopen them on the same database, and assert that all of it is intact. Put shared setup in `test/helpers/operator-restart.ts`, patterned on `test/helpers/guest-restart.ts`, not copied from it.

## Out of scope

- Guest-side changes. Revenue (06c).

## Acceptance criteria

- AC1: Enforcement state applied before a restart is still in force after it. Failure path: a suspended operator is still refused after the restart.
- AC2: Owner-side booking state survives a restart.
- AC3: With `production: true`, `#demoRequests` is never populated. Failure path: a test constructs a production environment and asserts that no demo request is visible.
- AC4: The operator restart test passes end to end: session, grant, request action, revenue, enforcement and audit.
- AC5: `npm test` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0064 | Graduated operator enforcement | persisted enforcement state |
| 0086 | Restart-safe sessions | restart test |
| 0004 | Backend owns state | no instance-only state |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments

- 6 Oct 2026 pre-code audit. `OperatorEnforcementManager` instance state, field by field:
  - `#incidents` (Map by incidentId): persisted. Incidents decide misconduct counts and turnover revocation, so they cannot be re-derived.
  - `#protectiveActions` (Map by enforcementId): persisted. This is the immediate suspension itself.
  - `#finalizedEnforcements` (Map by enforcementId): persisted. The final human decision (pause, termination, suspension).
  - `#notices` (Map by enforcementId): persisted. The appeal window runs from a delivered notice.
  - `#appeals` (Map by `appeal_<enforcementId>`): persisted. Resolution now writes a new record instead of mutating one in place.
  - `#restoredUnits` (Set of `operatorId:unitId`): persisted as a keyed collection. It lifts a unit's turnover suspension.
  - `#restorationDispositions` (array): persisted as a collection keyed by enforcementId. It is only ever searched by enforcementId, so one row per enforcement is equivalent to the old append-only list.
  - `#initialDecisionMakers` (Map enforcementId to human id): persisted. It enforces appeal reviewer independence.
  - `#sequence` (counter behind `enf_N`): persisted in `operator_enforcement_sequence`; ids are never reused after a restart.
  - `#operatorAuthority` and `#clock`: injected collaborators (the grant store and the environment clock), not state; nothing to persist.
  Same shape as 06c: the manager keeps its API and takes an optional `store`; the default is in memory, the owner environment passes `SqliteOperatorEnforcementStateStore` on the shared handle. Multi-step decisions (protective action = id + restoration cleared + record; finalize = record + decision maker; restore = disposition + restored unit) run in one `transaction`, so a failure leaves nothing behind.
- Booking state: the owner already read and wrote the shared `booking_contracts` / `booking_reservations` tables through `#bookingState` (`SqliteBookingStateRepository`). The Guest composition uses the same two tables, so both sides see the same rows. The only in-memory instance was the public, unused `bookingStateRepository` field; it now aliases the shared repository.
- `#demoRequests`: written only by `createDemoIncomingBookingRequest`, read only by `getStateOverview`. A new `production` flag on the owner config (passed by the production pilot) makes the first throw and the second return no requests. The route that serves the overview is already refused when the server is in production.
- **Finding, not fixed here:** `ReservePayoutManager` (`reserve-payout-trust.ts`) also keeps in-memory `#tranches`, `#adminHolds` and `#executedCommands`. Admin holds feed trust-tier and payout decisions, so they are enforcement-like, but neither 06c nor 06d lists them. They are not covered here; they need their own audit before 15. Done in 06e.

## Answer

Resolved 6 Oct 2026. Enforcement state (incidents, protective actions, final decisions, notices, appeals, restorations, decision makers and the id sequence) now lives on the shared handle through `SqliteOperatorEnforcementStateStore`; `OperatorEnforcementManager` keeps its API and an in-memory default. The whole existing enforcement policy suite (`test/apply-graduated-operator-enforcement.test.ts`) now runs against both stores and passes unchanged.

- AC1: `test/operator-process-restart.test.ts` pauses an operator, restarts the server and environment over the same file, and finds the projection and trust-tier override unchanged. It also shows enforcement ids carry on after a restart. A mutation check (removing the store from the owner environment) made it fail. `test/sqlite-operator-enforcement-state.test.ts` covers insertion order, a rollback that consumes no id, no credentials in stored records and this audit.
- AC2: a paid Reservation made through the back office and the Guest payment survives a restart, read from the shared tables.
- AC3: production refuses demo requests and shows none; the demo configuration still works.
- AC4: one test provisions and signs in, acts on a request, records revenue, applies enforcement, restarts, then checks the pre-restart session cookie, grants, request status, revenue release, enforcement projection and the audit trail in order. Shared setup is in `test/helpers/operator-restart.ts`.
- ADRs: 0064 (graduated enforcement persisted), 0086 (the pre-restart session still works), 0004 (no instance-only state), 0075 (no credentials in stored records).
