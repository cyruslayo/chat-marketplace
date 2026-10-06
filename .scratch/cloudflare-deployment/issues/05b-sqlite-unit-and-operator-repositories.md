# SQLite unit and operator repositories

Status: resolved
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

| ADR | Constraint | Acceptance path |
| --- | --- | --- |
| 0004 / 0095 | Shared synchronous SQL authority | AC1/AC3/AC4/AC5 repositories |
| 0008 / 0009 / 0056 | Retain evidence dates; eligibility evaluated at query time | AC2 discovery clock |
| 0075 | No new logging or credential storage | All writes |

Reuse existing UnitRepository normalization and operator validation; no eligibility cache, new loader, or app wiring. Shared behaviour contract covers JSON and SQLite. The existing inventory-template CSV supplies synthetic import parity data.

## Answer

Implementation `d1d6687`, update-validation parity fix `068a013`, integrated by `cde0195` and its follow-up merge. Added `SqliteUnitRepository` and `SqliteOperatorRepository`, exported from the domain entrypoint. Both borrow the SQL port and validate using existing canonical normalizers. No eligibility cache or derived eligibility flag is stored. Unit partial saves preserve normalized data, caller-isolated reads and JSON ordering; delete/insert is atomic. Operator duplicate identity raises OperatorConflictError without changing rows; update preserves JSON trimming, timestamp and invalid/missing-name semantics, including runtime null refusal. Existing import and bootstrap paths work unchanged.

Dedicated AC1–AC5 tests in `test/sqlite-repositories.test.ts` were run red before implementation. AC1 shares `test/helpers/unit-repository-contract.ts` between JSON/SQLite for normalization, partial saves, isolation and malformed-input refusal. AC2 advances the existing discovery clock past a 12-month inspection expiry without rebuilding the loaded repository. AC3 covers duplicate/no-write and invalid updates. AC4 imports the same committed synthetic CSV then bootstraps operators on both paths and compares outputs. AC5 closes/reopens one file and compares units/operators exactly.

DoD checked item by item: (1) separate named AC tests; (2) expiry removes discovery, duplicate leaves data unchanged, malformed/null updates throw; (3) ADR 0004/0008/0009/0056/0075/0095 constraints read/reverified; (4) database and clock used; (5) no invented policy/loader; (6) no new logs or credentials; (7) final integrated typecheck and full Node suite pass: **1,281 non-browser + 165 browser, zero failures, one expected skip**; **14 Workers tests** also pass. Evidence in the integration worktree's `.scratch/cf-wave2-confirmed.log`, `cf-wave2-check.log`, `cf-wave2-workers.log`. No pilot/DO wiring or operations route is added; those remain 10a/10b/11b.

