# Move the availability and guest-interaction stores onto `SqlDatabase`

Status: claimed
Type: task
Blocked by: 02a
Branch: `infra/cf-02c-availability-interaction`
Requested: 2 Oct 2026
Unlocks: 02e

## Why

These are the two largest stores: 24 and 36 prepared statements. They also hold the inventory and payment-attempt transactions. Today each can open its own connection from a path, and each sets `busy_timeout` even when given a shared handle. On a Durable Object there is exactly one handle, so these stores must only ever receive one.

## What to build

- `domains/shortlet/src/availability-store.ts`, `SqliteAvailabilityStore`:
  - The constructor at :81 is `(databasePath, database?)` and opens a connection if none is passed (:83). Change it to `(database: SqlDatabase)`.
  - Remove `PRAGMA busy_timeout` (:85).
  - Replace `BEGIN IMMEDIATE` (:111) with `database.transaction(fn)`.
- `domains/shortlet/src/guest-interaction-store.ts`, `SqliteGuestInteractionStore`:
  - Same changes: constructor at :301 and :303, `#ownsDatabase`, pragma at :305, `BEGIN IMMEDIATE` at :448.
  - `close()` must not close a handle it does not own. Once the constructor only takes a handle, the store owns nothing, so drop `#ownsDatabase`.
- Update every caller, including tests that relied on the path-first constructor, so they open through `openNodeSqliteDatabase(path)` (02a). If one test file needs a helper for this, put it in `test/helpers/`; don't copy it into each file (AGENTS.md anti-pattern 4).
- `SqliteLivePaymentAttemptRegistry` (`payment-attempt.ts:45`) wraps the interaction store. Confirm it still compiles unchanged.
- Watch `IN (...)` lists built from arrays in these stores. Note any that could exceed 100 parameters; the 03b adapter will reject those loudly. If one can, raise it in `## Comments`.

## Out of scope

- The other stores (02b, 02d) and the app layer (02e).
- Removing the `databasePath` fields (02d does this).

## Acceptance criteria

- AC1: Neither store accepts a path or opens a connection. Constructing one requires a `SqlDatabase`, and a type-level test or `tsc` proves the path signature is gone.
- AC2: The inventory hold is still exclusive. Failure path: a second hold over the same unit and dates inside an overlapping transaction is refused, and the first hold stands (ADRs 0039, 0041).
- AC3: There is still at most one live payment attempt per booking. Failure path: a second attempt is refused (ADR 0046).
- AC4: The full existing suite passes, including `test/guest-process-restart.test.ts`, and `npm run check` is clean.

## Tests

Add the files to `test/sql-port-store-imports.test.ts` (from 02b). Find the existing hold and live-attempt tests with `grep -l "SqliteAvailabilityStore\|LivePaymentAttempt" test/`. Extend them if they already cover AC2 and AC3 through the port; otherwise add focused ones.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0039 / 0041 | Authoritative 30-minute blocks per disclosed request | availability hold transaction |
| 0044 / 0046 | Payment window; one live attempt | interaction-store attempt transaction |
| 0004 | Single system of record | no private connection |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments

### Reconciled implementation plan

| ADR | Constraint | Acceptance/code path |
| --- | --- | --- |
| 0004 / 0095 | One backend-owned synchronous SQL handle | AC1 injected non-owning stores |
| 0039 / 0041 | Exclusive atomic inventory blocks | AC2 hold transaction/rollback |
| 0044 / 0046 | Preserve payment deadlines and one live attempt | AC3 registry reconstruction |
| 0075 | No credential logging | No logging or projection changes |

Reconciles the existing 02c worktree edits, correcting their borrowed-handle close() bug and completing missing callers/tests. No policy changes. Unread path labels are removed as coordinated with 02d. Full-suite gate remains pending.

Direct continuation checks: `npm run check`, focused availability/interaction/import/notifier/process-restart tests, `npm run test:workers`, and `git diff --check` passed. Dedicated AC1–AC4 tests were first run red in `cf-02c-red.log`, then green in `cf-02c-focused.log`. Both stores borrow the handle; tests close their own connections, including before reconstruction. No dynamic SQL `IN (...)` parameter lists exist in either store. The existing live-attempt registry API is unchanged. New row reads use text guards; SQL and policy values are unchanged. Automated formatting of touched files is retained rather than reverted.

DoD 1–6 reviewed: separate named tests, overlap/duplicate failure assertions, ADR table verified, dependencies used, no invented policies, no credentials/logging introduced. DoD 7 awaits the serial full-suite gate; keep claimed until then.
