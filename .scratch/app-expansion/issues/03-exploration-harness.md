# Exploration harness and the two trial checks

Status: ready-for-agent
Type: task
Blocked by: none

## Why

The trial (`trial/explore.mts`) found two unowned behaviours in 13 seconds. It is a script. The method needs a small helper and tests. The trial explored 5,460 orders; the rules 01 check plans ten steps, about 20 times as many, so the helper must prune.

## What to build

- `test/helpers/explore.ts` with `exploreOrders({ steps, depth, newWorld, check })` and `exploreFailures({ ports, resumes, newWorld, check })`. Each returns the number explored, the shortest failing sequence, and how often each step succeeded. No dependency, no domain knowledge, no `any`.
- `test/after-booking-exploration.test.ts`: the two trial checks over `CancellationApplication` and `BookingAmendmentManager` with `SqliteBookingStateRepository`, recorded as **known defects**. Each test name starts "KNOWN DEFECT (issue 04)" or "(issue 05)", so nobody reads the expectation as intended. Check A expects the known failing sequence, check B the known unfinished outcomes. Issues 04 and 05 change those expectations.
- Reuse `test/helpers/continuous-occupancy-fixture.ts` and `temporary-database.ts`. Move the booking fixture shared with `integrate-cancellation-application.test.ts` into a helper (AGENTS.md anti-pattern 4).

## Acceptance criteria

- AC1: The helper explores every order up to the depth and reports the shortest failing sequence first. Failure path: a check that never fails reports zero, with the per-step success counts.
- AC2: A step declared required that never succeeds in any order fails the test.
- AC3: The failure explorer fails each port once, in every combination, then resumes the given number of times.
- AC4: The change check finds "request, accept, cancel, commit" on SQLite.
- AC5: The cancellation check reports the seven unfinished combinations and their end state.
- AC6: The helper compares a caller-supplied digest of observable state after each prefix, and does not extend a prefix whose state was already explored at the same or smaller depth, or whose last step was refused and changed nothing. Failure path: a digest that omits a field the check reads makes a seeded defect disappear, and a test shows the helper's own guard against it (digest fields are declared and compared with the fields the check reads).
- AC7: The file finishes in under 30 seconds alone. Wider depth runs only from an explicit script, never from `npm test`.

## ADR compliance

| ADR | Constraint | Where |
| --- | --- | --- |
| 0058, 0060 | Cancellation and amendment authority | AC4, AC5 |
| 0075 | No credentials or contact data in output | AC1 |

## Notes

Issues 04 and 05 are not started here. Do not fix the behaviour.

## Comments
