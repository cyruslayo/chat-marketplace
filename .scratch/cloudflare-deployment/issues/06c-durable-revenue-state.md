# Durable revenue accounting and release state

Status: ready-for-agent
Type: task
Blocked by: 02a
Branch: `infra/cf-06c-revenue`
Requested: 2 Oct 2026
Unlocks: 06d

## Why

The owner environment builds `InMemoryRevenueAccountingRepository` (`domains/shortlet/src/revenue-accounting.ts:37`, created at `local-owner-environment.ts:462`) and `RevenueReleaseManager` (`revenue-release.ts:63`, created at :463). Revenue records and release decisions are money evidence. Losing them on restart is a production defect on Node, and it would happen routinely on a Durable Object.

## What to build

1. **Audit first.** Read `revenue-accounting.ts` and `revenue-release.ts`. List every field of instance state: Maps, arrays, counters. For each, record whether it can be re-derived from existing SQLite tables, such as the owner-payable ledger or booking state. Put the list in `## Comments` before writing code.
2. `SqliteRevenueAccountingRepository` implements the same interface as the in-memory one, on a `SqlDatabase`. Use transactions for multi-row writes.
3. For `RevenueReleaseManager`, persist the state that cannot be re-derived, in a table or through the new repository. Keep its public API unchanged.
4. The owner environment uses the SQLite implementations on its shared handle. The in-memory ones stay for tests.
5. **Amounts stay in kobo as integers** (ADR 0078). Store them as `INTEGER`, never as floats.

## Out of scope

- `OperatorEnforcementManager` and owner booking state (06d).
- Changing any revenue or release rule (ADRs 0062, 0083, 0089).

## Acceptance criteria

- AC1: The `## Comments` audit lists every piece of instance state, and either persists it or explains how it is re-derived.
- AC2: Revenue records and release decisions made before a restart are the same after it.
- AC3: A release that fails halfway leaves no partial ledger rows. Failure path: a thrown error inside the release transaction rolls everything back.
- AC4: Amounts round-trip exactly as integers in kobo. A test covers a value above 2^31.
- AC5: The existing revenue and release tests pass against both implementations through a shared contract helper. `npm run check` is clean.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0089 | Collect from guests; pay owners the agreed amount | ledger and release unchanged |
| 0062 / 0083 | Commission and settlement policy | no rule change |
| 0078 | Kobo integers | `INTEGER` columns |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments
