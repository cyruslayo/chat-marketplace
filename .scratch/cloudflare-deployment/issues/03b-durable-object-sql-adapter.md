# `DurableObjectSqlDatabase` passes the shared contract

Status: ready-for-agent
Type: task
Blocked by: 02a, 03a (and the 01a answers)
Branch: `infra/cf-03b-do-sql-adapter`
Requested: 2 Oct 2026
Unlocks: 10b

## Why

The domain stores talk to `SqlDatabase`. On Cloudflare that port must be backed by `ctx.storage.sql`, with the same transaction and parameter semantics the contract suite pins down on Node.

## What to build

`apps/cloudflare/src/do-sql-database.ts`:
- `DurableObjectSqlDatabase implements SqlDatabase`, built from `ctx.storage`.
- **Parameter translation.** Convert `$name` to the positional form that 01a confirmed works. Use a small tokenizer that skips single-quoted literals, double-quoted identifiers and comments. Cache the translation per SQL string in a `Map`, and pass the bindings in the right order. Throw if a `$name` has no value; never bind `undefined`.
- **`transaction`** maps to `ctx.storage.transactionSync`. If the callback returns a thenable, roll back and throw, as on Node. Nesting follows 01a's answer and matches the Node adapter.
- **`exec`** runs multi-statement strings, or splits them if 01a found that necessary. PRAGMAs that 01a found rejected (expected: `busy_timeout`, and maybe `journal_mode`) become no-ops. Any other rejected PRAGMA throws.
- **Results.** BLOBs come back as `Uint8Array`, and `run().changes` comes from `cursor.rowsWritten`, adjusted per 01a.
- **Limits.** Throw a descriptive error *before* executing when a statement binds more than 100 parameters or a value exceeds 2 MB. Define both as named constants that cite the Cloudflare Durable Object limits page in a comment. They are platform limits, not domain policy.
- `close()` is a no-op, since the Durable Object owns storage.

Contract wiring:
- `apps/cloudflare/test/sql-database-do.spec.ts` runs `runSqlDatabaseContract` from `test/helpers/sql-database-contract.ts` (02a) inside `runInDurableObject`. Adapt the registrar to vitest, and **do not copy the cases** (AGENTS.md anti-pattern 4).
- Adapter-only specs: the tokenizer skips `'$notparam'`, an unbound `$name` throws, 101 parameters throw, and a 2 MB + 1 byte value throws.

## Out of scope

- Running domain stores on the Durable Object (10b).
- Changing the contract's meaning. If a case can't pass on the Durable Object, stop and record it in `## Comments`; don't weaken the case.

## Acceptance criteria

- AC1: Every shared contract case passes under `npm run test:workers` against `DurableObjectSqlDatabase`, and still passes under `npm test` against `NodeSqliteDatabase`.
- AC2: Named parameters inside quoted literals are not translated, and an unbound name throws.
- AC3: A transaction that throws rolls back fully. Failure path: the concurrent-hold conflict case lets only one transaction write.
- AC4: More than 100 bound parameters, or a value over 2 MB, is refused with a descriptive error before execution.
- AC5: The adapter module imports nothing from `node:sqlite`, and `npm run check` is clean for both trees.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0041 / 0044 / 0046 | Atomic read-then-write; no `await` inside | `transaction` maps to `transactionSync`, and a thenable is refused |
| 0004 | Single system of record | the adapter adds no cache of rows (only of SQL translations) |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`. Item 7 also covers `npm run test:workers`.

## Comments
