# Move the operator grant and session stores onto the shared handle

Status: resolved
Type: task
Blocked by: 02a
Branch: `infra/cf-02d-operator-stores-reconciled`
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
- AC2: An operator session issued before a restart, using a new environment on the same file, is still valid afterwards, and is expired after 12 hours (ADR 0086); an unconsumed access token expires after 30 minutes. Failure path: an expired or revoked session is refused after the restart.
- AC3: Revoking a representative grant is atomic. Failure path: a throw mid-revoke leaves the grant active and the audit unchanged.
- AC4: No `databasePath` field remains on a converted store, and `npm run check` and `npm test` pass.

## Tests

Extend `test/sql-port-store-imports.test.ts`. For AC2, reuse the existing operator-session tests (`grep -l SqliteOperatorSessionAuthority test/`) and add a restart case.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0086 | Hashed 30-minute access tokens; absolute 12-hour sessions that survive restarts | session authority on the shared handle |
| 0082 | Explicit representative grants | grant store transaction |
| 0075 | No tokens in logs | unchanged; check that no new log line is added |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments

### ADR implementation plan

| ADR | Constraint | Acceptance / code path |
| --- | --- | --- |
| 0086 | 30-minute single-use access tokens; hashed, absolute 12-hour sessions; durable revocation | AC1/AC2 shared session handle and restart/expiry tests |
| 0082 | Explicit grants with atomic minimal audit transitions | AC3 nested transaction rollback test |
| 0075 | No raw secrets, cookies or identity evidence in logs | Existing minimal metadata unchanged |
| 0004 / 0095 | Single backend-owned synchronous handle | AC1/AC4 stores borrow the composition handle |

Corrected the issue's 30-minute session wording to the accepted ADR's 12 hours; no authentication policy is changed. 02c has landed, so all five unread store path labels can now be removed. Existing test-only path convenience factories will own their connections; domain stores never do.

## Answer

Implementation `491c399`, integrated by `d142a37`. Recovered the unfinished worktree from the main repo's `.scratch` into a sibling worktree, preserved all seven dirty files byte-for-byte in the integration recovery folder, and removed three verified formatting-only changes before committing. Both operator stores now borrow `SqlDatabase`, use its transaction boundary and never close the composition handle. Every app/CLI/test caller compiles through shared handles or the shared test-owned convenience factories. All five unread path fields are gone; the two remaining label-only constructor arguments and callers were also removed.

Dedicated AC1–AC4 tests: `test/sql-port-operator-stores.test.ts` (red before completing callers). Covers borrowed-handle close, environment restart, consumed-token replay, 30-minute token expiry, 12-hour absolute session expiry, persisted revocation/wrong-secret refusal, nested mid-revoke rollback and no path fields. Import guard extended. Updated the old inbox test to revoke authority explicitly rather than close a borrowed store; its old close-as-revocation assumption was the only non-browser failure in the first full run.

DoD checked item by item: (1) separate named AC tests; (2) every named refusal/rollback path asserted; (3) ADR 0004/0075/0082/0086/0095 constraints read and verified; (4) injected handles/clocks/sinks consumed; (5) no authentication-policy change or invented value; (6) no new logging/raw credentials; (7) final integrated `npm run check`, `npm test` and Workers tests pass. Final Node gate: **1,281 non-browser + 165 browser passed, zero failures, one expected skip**. Workers gate: **14 passed**. Evidence lives in the integration worktree: `.scratch/cf-wave2-confirmed.log`, `cf-wave2-check.log`, `cf-wave2-workers.log`. `PI_REASONING_LEVEL` was unset for Node tests because an existing NIN environment check matches that harness variable. The preceding run had two Chrome startup failures; isolated retry and the entire subsequent suite passed without a UI/source workaround.

