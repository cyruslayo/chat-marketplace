# Typed unit repository interface

Status: claimed
Type: task
Blocked by: none
Branch: `infra/cf-05a-unit-repository-interface`
Requested: 2 Oct 2026
Unlocks: 05b

## Why

`SqliteUnitRepository` (05b) needs an interface to implement. Today there isn't one:
- `UnitRepository` (`domains/shortlet/src/browse.ts:200`) is a concrete in-memory class.
- `JsonUnitRepository` (:213) is a structural copy whose `findAll(): any[]` (:228) and `findById(): any` (:233) break the no-`any` rule.

`OperatorRepository` already exists as an interface (`operator.ts:24`).

## What to build

- Find every consumer of `UnitRepository` and `JsonUnitRepository` (`grep -rn "UnitRepository" apps domains packages test`), and record which methods each one uses.
- Introduce a typed interface for those methods: `save(unit: UnitSaveInput): void`, `findAll(): readonly Unit[]` and `findById(id): Unit | null`, plus anything else the consumers need. Pick the naming that changes the fewest call sites, for example rename the class to `InMemoryUnitRepository` and keep `UnitRepository` as the interface name. Record the choice in `## Comments`.
- Make the in-memory and JSON classes implement it, and remove the `any`s. If JSON parsing needs narrowing, add a guard function rather than a cast.
- Check the existing structural interfaces too: `InventoryRepository` (`inventory-import.ts:46`) and the `{ findAll(): Unit[] }` input of `bootstrapOperatorsFromUnitRepository` (`operator.ts:174`). Make them compatible with, or derived from, the new interface.

## Out of scope

- Adding the SQLite implementation (05b).
- Changing unit eligibility or publication behaviour.

## Acceptance criteria

- AC1: `browse.ts` contains no `any` on the unit repositories, and `npm run check` is clean.
- AC2: Both existing implementations satisfy the interface. A compile-time assertion (for example `const _: UnitRepository = new JsonUnitRepository(...)` in a test) proves it.
- AC3: The JSON repository rejects a malformed inventory file with a clear error instead of returning untyped data. Failure path: a test file with a missing `id` throws.
- AC4: The full suite passes.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0008 / 0009 / 0056 | Publication eligibility is unchanged | no behaviour change; the existing tests stay green |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments

- Name choice: `UnitRepositoryContract` avoids renaming the existing concrete `UnitRepository` and changing its many call sites, while giving the SQLite implementation in 05b a stable shared contract.
- Consumer method inventory: discovery and ranking read `findAll`; booking/request, availability, and verification paths read by id (and the availability calendar updates with `save`); inventory import and publication use all three; operator bootstrapping reads `findAll`. Local guest/owner environments expose the concrete repositories but do not require extra methods. Test fixtures instantiate both implementations directly.
- ADR mapping: 0008/0009/0056 require unit publication eligibility to continue using approved inspection evidence and its validity through checkout. This slice leaves eligibility evaluation unchanged; repository results remain typed units and existing clock-based checks stay in `browse.ts`.

## Answer

- Added `UnitRepositoryContract`; both in-memory and JSON implementations implement it. Inventory import derives its repository boundary from the contract, and operator bootstrap accepts its readonly `findAll` result.
- JSON reads now narrow parsed entries before normalization and throw a clear `TypeError` for a missing/blank id or malformed Unit shape.
- `npm run check` passed. The repository-contract tests and back-office calendar tests passed (AC1–AC3 coverage included). The isolated phase-3 Chromium test passed when rerun after the screenshot output directory existed.
- `npm test` did not pass: phase 1 reported 1,229 passed and 4 failed; the same four failures were present in the preceding `02a` full-suite run. The separate 05a full-suite Chromium phase reported 164 passed, 1 skipped, and 1 setup failure because `.scratch/ui-phase3-discovery-detail` did not exist at suite start; the failing browser test passed on isolated rerun. AC4 remains open pending the baseline failures and suite output-directory setup being corrected.
