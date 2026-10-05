# `SqlDatabase` port, Node adapter and contract helper

Status: resolved
Type: task
Blocked by: none (if 01a has been answered, read its "Consequences" list first)
Branch: `infra/cf-02a-sql-database-port`
Requested: 2 Oct 2026
Unlocks: 02b, 02c, 02d, 03b, 05b, 06a, 06b, 06c

## Why

The domain layer calls `node:sqlite` `DatabaseSync` directly in 17 production files (about 126 prepared statements). A synchronous port lets the same stores run on Node and on Durable Object SQL. This slice adds the port and the Node adapter only. **No store moves yet**, which keeps the slice small and the suite trivially green.

## What to build

- `packages/platform-core/src/sql-database.ts`, with types only and no `any`:
  - `SqlValue = string | number | bigint | null | Uint8Array`
  - `SqlRow = Record<string, SqlValue>`
  - `SqlParams = Record<string, SqlValue>` (named `$params`, matching how the stores call it today). Check whether any store uses positional arrays, and support them too if so.
  - `SqlStatement { get(params?): SqlRow | undefined; all(params?): SqlRow[]; run(params?): { changes: number } }`
  - `SqlDatabase { prepare(sql): SqlStatement; exec(sql): void; transaction<T>(fn: () => T): T; close(): void }`
  - Document on `transaction`: it is synchronous, the callback must not return a Promise, and it rolls back on throw (ADRs 0041, 0044, 0046).
- `packages/platform-core/src/node-sqlite-database.ts`, a separate module so the Worker bundle never imports `node:sqlite`:
  - `NodeSqliteDatabase` wraps `DatabaseSync`. `openNodeSqliteDatabase(path)` runs `mkdirSync` on the parent directory, then opens the file.
  - On open, set `PRAGMA busy_timeout` (keep today's 5000 ms, already used at `availability-store.ts:85`, `guest-interaction-store.ts:305` and `fixture.ts:261`) and `PRAGMA foreign_keys = ON`.
  - `transaction(fn)`: `BEGIN IMMEDIATE`, then `COMMIT`, or `ROLLBACK` and rethrow. Decide how nesting behaves to match 01a's answer: either a nested call joins the outer transaction, or it throws loudly. Never silently commit early.
  - If `fn` returns a thenable, roll back and throw. This catches a forbidden `await` on Node, not only on Cloudflare.
- `test/helpers/sql-database-contract.ts`, a shared, runtime-agnostic suite: `runSqlDatabaseContract(name, open: () => SqlDatabase, register: TestRegistrar)`. Keep it free of `node:test` imports so slice 03b can run it under vitest too. It covers:
  - named parameters, including a value that looks like `$x` inside a string literal
  - `get`, `all` and `run` with `changes`
  - BLOB round trip as a `Uint8Array`
  - rollback on throw
  - rejection of a thenable-returning callback
  - multi-statement `exec`
  - a concurrent-hold conflict: two read-then-write transactions on the same row, where only one succeeds
- `test/sql-database-node.test.ts` runs the contract against `NodeSqliteDatabase` on a temp file.

## Out of scope

- Converting any store (02b–02e).
- The Durable Object adapter (03b).

## Acceptance criteria

- AC1: The port types compile with no `any` and no `as` casts, and `npm run check` is clean.
- AC2: `NodeSqliteDatabase` passes every contract case, including rollback on throw and the concurrent-hold conflict. Failure path: the losing transaction's write is not visible afterwards.
- AC3: A transaction callback that returns a Promise is rolled back and throws.
- AC4: `node-sqlite-database.ts` is the only new file that imports `node:sqlite`, and `sql-database.ts` imports nothing from `node:*`.

## Tests

`test/sql-database-node.test.ts` (one `test()` per AC) and `test/helpers/sql-database-contract.ts`. `scripts/run-tests.mjs` picks up top-level `test/*.test.ts` automatically.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0004 | One authoritative store | The port exposes no caching. |
| 0041 / 0044 / 0046 | Atomic read-then-write | `transaction` uses `BEGIN IMMEDIATE`; a thenable is rejected. |

## Watch-outs

The 5000 ms busy timeout is an existing value, not a new policy. Cite where it comes from in a comment.

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments

- ADR mapping: 0004 keeps authoritative state in the backend and the adapter adds no cache (AC1/AC2); 0041, 0044 and 0046 require serialized atomic read-then-write transitions (AC2/AC3), implemented with `BEGIN IMMEDIATE`, nested savepoints, rollback on throw, and thenable rejection. The 01a probe found nested Durable Object transactions have savepoint-like rollback boundaries: a nested failure can be caught while the outer transaction continues, while an outer failure rolls back successful nested work.

## Answer

- Added `SqlDatabase`, a Node `node:sqlite` adapter, and a runtime-agnostic contract suite. Node transactions use `BEGIN IMMEDIATE` at the outer boundary and savepoints when nested, matching the 01a Durable Object SQL probe.
- `npm run check` passed. `test/sql-database-node.test.ts` passed all 12 tests, including eight shared contract cases for Node.
- On 5 October 2026, the full serial `npm test` passed cleanly: Phase 1 passed all 1,245 concurrent tests and Phase 2 passed all 165 real-browser tests (1 skipped per design). `npm run check` and `git diff --check` passed with zero errors. All acceptance criteria AC1–AC4 and Definition of Done checks are satisfied.
