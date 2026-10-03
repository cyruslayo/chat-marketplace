# SQLite unit and operator repositories

Status: ready-for-agent
Type: task
Blocked by: 02a, 05a
Branch: `infra/cf-05b-sqlite-repositories`
Requested: 2 Oct 2026
Unlocks: 10a

## Why

The production pilot loads inventory and operators from JSON files on disk (`SHORTLET_*` paths in `apps/pilot/src/pilot-config.ts`). A Durable Object has no filesystem, so both must live in SQLite and be loaded through the existing import paths.

## What to build

- `domains/shortlet/src/sqlite-unit-repository.ts`: `SqliteUnitRepository implements UnitRepository` (from 05a), with a `units` table created on construction.
  - If it caches `findAll()`, it must invalidate the cache on `save`.
  - **Publication eligibility is not stored as a flag.** Keep the raw inspection and approval dates, and let the existing eligibility code evaluate them against the clock at read time (ADRs 0008, 0009, 0056; AGENTS.md anti-pattern 2).
- `domains/shortlet/src/sqlite-operator-repository.ts`: `SqliteOperatorRepository implements OperatorRepository` (`operator.ts:24`). Keep the semantics of `create`, `findById`, `findAll` and `update`, including `OperatorConflictError` on a duplicate.
- Both take a `SqlDatabase` and use `database.transaction` for multi-row writes.
- Loading:
  - `importInventoryCsv(contents, options)` (`inventory-import.ts:380`) must work against `SqliteUnitRepository` through its `InventoryRepository` (:46).
  - `bootstrapOperatorsFromUnitRepository` (`operator.ts:174`) must work with both new repositories.
  - Don't add a new loader.
- Keep the JSON repositories for local development and fixtures.

## Out of scope

- Wiring these into the pilot or the Durable Object (10a, 10b).
- The `/_ops` import route (11b).

## Acceptance criteria

- AC1: `SqliteUnitRepository` passes the same behaviour tests as the JSON repository. Extract those tests into a shared helper (`test/helpers/unit-repository-contract.ts`) rather than duplicating them.
- AC2: A unit whose inspection expires while the repository is loaded becomes ineligible without a reload. Failure path: advancing the injected clock past the 12-month expiry removes it from discovery (ADR 0009).
- AC3: `SqliteOperatorRepository` refuses a duplicate operator with `OperatorConflictError` and leaves the table unchanged.
- AC4: `importInventoryCsv` into `SqliteUnitRepository`, followed by `bootstrapOperatorsFromUnitRepository` into `SqliteOperatorRepository`, gives the same units and operators as the JSON path for the same CSV.
- AC5: Data survives reopening the database. `npm test` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0008 / 0009 / 0056 | Inspection-gated publication, evaluated lazily | read-time eligibility |
| 0004 | One system of record | SQLite, no file |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments
