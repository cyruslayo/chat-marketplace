# Typed unit repository interface

Status: ready-for-agent
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
