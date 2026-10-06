# Injectable owner composition root

Status: resolved
Type: task
Blocked by: 02e
Branch: `infra/cf-04b-owner-root`
Requested: 2 Oct 2026
Unlocks: 06d, 08b

## Why

This is the same as 04a, for the operator back office. `LocalApartmentOwnerEnvironment` opens its own file and reads inventory and operators from JSON paths.

## What to build

`apps/local-owner/src/local-owner-environment.ts`:
- `LocalApartmentOwnerEnvironment` (:422) takes `Partial<LocalOwnerFixtureConfig>` (interface :86, defaults :336). It runs `mkdirSync`, then `openNodeSqliteDatabase` (after 02e), and picks `JsonUnitRepository` and `JsonOperatorRepository` from `inventoryPath` and `operatorsPath` (:439–440).
- Add `deps: { database: SqlDatabase; unitRepository; operatorRepository }`, with no filesystem access when deps are given.
- Add a Node factory that keeps today's path behaviour and owns the handle.
- `close()` (:1552) closes only an owned handle.
- Update the call sites (`local-owner-server.ts`, the pilot composition, `apps/local-owner/src/cli-*.ts`, tests) to use the factory.
- Leave the in-memory repositories (:442, :462, :463, :471) alone; 06c and 06d replace them.

## Out of scope

- The guest environment (04a), in-memory state persistence (06), and handler extraction (08b).

## Acceptance criteria

- AC1: Constructed with injected deps, the environment does no filesystem access.
- AC2: `close()` leaves an injected database open. Failure path: a query after `close()` succeeds.
- AC3: A factory-built environment owns and closes its database.
- AC4: The CLIs `operator:provision` and `operator:revoke`, the owner local server and all tests behave the same. `npm test` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0086 | Restart-safe operator sessions | session authority uses the injected handle |
| 0004 | One handle | injected database |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments

## Answer

Resolved 6 Oct 2026. `new LocalApartmentOwnerEnvironment(config, { database, unitRepository, operatorRepository })` does no filesystem access (`operatorRepository` stays nullable, as today); `openNode(config)` keeps the path behaviour, owns the handle and releases it if construction throws; `close()` closes only an owned handle. The operator JSON repository gets the same clock as before (`config.clock` or the fixture default).

- Call sites moved to `openNode`: `cli-provision.ts`, `cli-revoke.ts`, `local-owner-server.ts` (default and reset), scripts and tests. The pilot servers inject the shared handle. `operator:provision`/`operator:revoke` behave the same (existing suites pass).
- Tests: `test/owner-environment-injection.test.ts` (AC1–AC3, plus the failed-construction release).
- ADRs: 0086 (the session authority uses the injected handle; restart-safe sessions unchanged), 0004.
