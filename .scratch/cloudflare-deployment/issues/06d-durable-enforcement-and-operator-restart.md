# Durable enforcement and owner booking state; operator restart test

Status: ready-for-agent
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
