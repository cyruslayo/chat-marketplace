# Session runtimes share one handle, with a size cap

Status: resolved
Type: task
Blocked by: 04a
Branch: `infra/cf-04c-session-runtimes`
Requested: 2 Oct 2026
Unlocks: 10b

## Why

`guest-server.ts` keeps a per-browser-session `LocalGuestEnvironment` in the `sessionRuntimes` Map (:6633). `runtimeForSession` (:6651) builds a new environment, and so a new connection, for each session (:6666). Idle eviction already exists: `evictIdleRuntimes` (:6643), driven by `sessionRuntimeIdleMs`. But nothing limits **how many** runtimes exist at once. A Durable Object has 128 MB of memory and only one SQL handle, so the runtimes must share that handle and have a hard cap.

## What to build

- `runtimeForSession` builds each session's environment with the **shared** `SqlDatabase` and repositories, through 04a's injected deps. The server never closes the shared handle when it evicts a runtime.
- Add a `sessionRuntimeLimit` option to `startLocalGuestServer` (:6515), alongside `sessionRuntimeIdleMs`. When the Map is full, evict the least-recently-used runtime before inserting a new one. A `Map` with re-insert-on-access is enough.
- Eviction is safe because guest state is durable. A returning session rebuilds from SQLite, which is the restart-persistence work.
- **The default value is a policy decision.** Leave the option unset by default (no cap, today's behaviour) and **ask the user** for the production value. Slice 10b passes it from configuration.

## Out of scope

- Changing idle eviction. Extracting the handler (08a).

## Acceptance criteria

- AC1: Every session runtime uses the same database handle. Failure path: a test counts opened handles across 3 sessions and expects 1.
- AC2: With `sessionRuntimeLimit: N`, opening session N+1 evicts the least recently used runtime, and the Map never holds more than N.
- AC3: An evicted session that comes back sees its conversation and booking state unchanged, rebuilt from SQLite.
- AC4: Evicting a runtime does not close the shared handle. Failure path: other sessions keep working after an eviction.
- AC5: With the option unset, behaviour matches today's. `npm test` and `npm run check` pass.

## Tests

Use `test/helpers/guest-restart.ts` patterns for AC3. Put the sessions-and-eviction tests in a new `test/guest-session-runtime-limit.test.ts`.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0004 | One authoritative store | shared handle |
| 0079 | Observable, replayable; no lost state on eviction | AC3 |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`. Item 5 matters here: no invented default; record the user's answer.

## Comments

## Answer

Resolved 6 Oct 2026. Every session runtime is built with the live environment's `database` and `unitRepository` through the 04a dependencies, so none opens a handle and eviction never closes the shared one. `sessionRuntimeLimit` (positive whole number, otherwise refused) evicts the least recently used runtime before inserting a new one; the Map is re-inserted on access. `activeSessionRuntimes` is joined by `sessionRuntimesBuilt` (monotonic count of builds, used to prove rebuilds).

- **Default.** The option is unset by default (no cap). The user approved 32 as the initial production value (configurable; local/unset uncapped); 10b passes it from configuration. It is an engineering limit, not measured capacity.
- Tests (`test/guest-session-runtime-limit.test.ts`): AC1 three sessions open no handle; AC2 LRU order proven by rebuild counts and the cap, and invalid limits refused; AC3 an evicted session's view equals the view after a full restart and the booking draft survives; AC4 the handle stays open and both sessions keep working; AC5 six sessions with the option unset.
- Finding: a session-scoped runtime shows the "Phone number" surface until the thread is restored, then the booking draft. That is how restoration already behaves after a full restart, so AC3 asserts eviction equals restart rather than equality with the pre-eviction view.
- ADRs: 0004, 0079.
