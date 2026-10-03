# Injectable guest composition root

Status: ready-for-agent
Type: task
Blocked by: 02e
Branch: `infra/cf-04a-guest-root`
Requested: 2 Oct 2026
Unlocks: 04c, 08a

## Why

`LocalGuestEnvironment` builds its own SQLite file and inventory from paths. The Durable Object must hand it the one `SqlDatabase`, plus SQLite-backed repositories (05b), without touching the filesystem.

## What to build

`apps/local-guest/src/fixture.ts`:
- `LocalGuestEnvironment` (:247) currently takes `Partial<LocalGuestFixtureConfig>` (interface :49, defaults `DEFAULT_LOCAL_GUEST_CONFIG` :94). It calls `mkdirSync` (:254), opens the database (:260), and picks `JsonUnitRepository` or `UnitRepository` from `inventoryPath` (:270).
- Add a dependencies argument, for example `new LocalGuestEnvironment(config, deps)` with `deps: { database: SqlDatabase; unitRepository; operatorRepository? }`. Use the repository types available today; 05a will tighten the unit type. The constructor must do **no** filesystem access when deps are given.
- Add `LocalGuestEnvironment.openNode(config)` (or a free `openLocalGuestEnvironment(config)`). It contains today's path logic (`mkdirSync`, `openNodeSqliteDatabase`, JSON or in-memory repositories) and marks the environment as the **owner** of the handle.
- `close()` (:620) closes the database only if the environment owns it.
- Update the call sites to use the factory: the CLIs, `guest-server.ts` `runtimeForSession` (:6666), the pilot composition and tests. Keep the call sites mechanical. `runtimeForSession` keeps opening one environment per session for now; 04c changes that.

## Out of scope

- The owner environment (04b).
- Changing the session-runtime model (04c).
- SQLite repositories (05b).

## Acceptance criteria

- AC1: Constructed with injected deps, the environment does no filesystem access. Failure path: a test stubs `node:fs` (or passes a database whose path doesn't exist) and the constructor still succeeds without creating anything.
- AC2: `close()` on an environment built with an injected database leaves that database usable. Failure path: a query after `close()` still succeeds.
- AC3: `close()` on a factory-built environment closes its own database.
- AC4: Every existing CLI and test behaves the same. `npm test` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0004 | The backend owns state; one handle | injected database |
| 0079 | Restart-safe guest state | `test/guest-process-restart.test.ts` still passes |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`. Item 4 matters here: every injected dependency is used.

## Comments
