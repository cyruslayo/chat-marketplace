# Move the operator grant and session stores onto the shared handle

Status: ready-for-agent
Type: task
Blocked by: 02a
Branch: `infra/cf-02d-operator-stores`
Requested: 2 Oct 2026
Unlocks: 02e

## Why

Two operator stores always open their own SQLite connection from a path. That gives the owner environment three connections to one file, and the guest environment two. A Durable Object has exactly one handle, and operator sessions must survive restarts in it (ADR 0086).

## What to build

- `domains/shortlet/src/operator-representative-authority.ts`, `SqliteOperatorRepresentativeGrantStore`: the constructor at :144 is `(databasePath, { clock })` and runs `new DatabaseSync` at :147 and a pragma at :148. Change it to `(database: SqlDatabase, { clock })`, and replace `BEGIN IMMEDIATE` at :173 with `database.transaction`.
- `domains/shortlet/src/operator-session-authority.ts`, `SqliteOperatorSessionAuthority`: the constructor at :22 is `(databasePath, { clock, audit, telemetry })`, with a connection at :23, a pragma at :24 and `#tx` at :37. Make the same change.
- Callers to update:
  - `apps/local-guest/src/fixture.ts:269` (grant store)
  - `apps/local-owner/src/local-owner-environment.ts:437–438`
  - tests
  The callers pass the environment's existing handle, wrapped as in 02b.
- **Drop the unread `databasePath` fields** in all five classes that store one: `availability-store.ts:76`, `booking-payment-journey.ts:54`, `booking-state.ts:82`, `guest-interaction-store.ts:296` and `operator-representative-authority.ts:139`. A grep (2 Oct 2026) found nothing that reads `<store>.databasePath`. Re-run the grep first. If 02b or 02c has not landed yet, coordinate: drop only the fields in files that are already converted, and note the rest in `## Comments`.
- Close each store's connection in the environment's `close()` only once, since the stores now own nothing.

## Out of scope

- The app layer (02e), and any change to session or grant semantics.

## Acceptance criteria

- AC1: Neither operator store opens a connection or accepts a path.
- AC2: An operator session issued before a restart, using a new environment on the same file, is still valid afterwards, and is still expired after 30 minutes (ADR 0086). Failure path: an expired or revoked session is refused after the restart.
- AC3: Revoking a representative grant is atomic. Failure path: a throw mid-revoke leaves the grant active and the audit unchanged.
- AC4: No `databasePath` field remains on a converted store, and `npm run check` and `npm test` pass.

## Tests

Extend `test/sql-port-store-imports.test.ts`. For AC2, reuse the existing operator-session tests (`grep -l SqliteOperatorSessionAuthority test/`) and add a restart case.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0086 | Hashed tokens; 30-minute sessions that survive restarts | session authority on the shared handle |
| 0082 | Explicit representative grants | grant store transaction |
| 0075 | No tokens in logs | unchanged; check that no new log line is added |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments
