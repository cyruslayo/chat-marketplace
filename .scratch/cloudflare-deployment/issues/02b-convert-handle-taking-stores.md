# Move the seven handle-taking stores onto `SqlDatabase`

Status: ready-for-agent
Type: task
Blocked by: 02a
Branch: `infra/cf-02b-handle-stores`
Requested: 2 Oct 2026
Unlocks: 02e, 07a

## Why

Seven stores already take a database handle in their constructor. Swapping their parameter type from `DatabaseSync` to `SqlDatabase` is mechanical and low-risk, and it proves the port against real domain code.

## What to build

Change each constructor to accept `SqlDatabase`, and remove the `node:sqlite` import from each file. All files are in `domains/shortlet/src/`:

| File | Class | Constructor |
| --- | --- | --- |
| `manual-transfer.ts` | `SqliteManualTransferStore` | :133 `(database)` |
| `owner-payable.ts` | `SqliteOwnerPayableLedger` | :416 `(database, clock)` |
| `booking-state.ts` | `SqliteBookingStateRepository` | :86 `(database, databasePath)`, with `BEGIN IMMEDIATE` at :123 |
| `bank-transfer.ts` | `SqliteBankTransferSessionStore` | :113 `(database)` |
| `booking-payment-journey.ts` | `SqliteBookingPaymentJourneyRepository` | :59 `(database, databasePath)` |
| `checkin-support.ts` | `SqliteCheckInSupportStore` | :113 `(database)` |
| `guest-contact.ts` | `SqliteGuestContactRepository` | :43 `(database)` |

Steps:
- Replace the hand-rolled `BEGIN IMMEDIATE` in `booking-state.ts:123` with `database.transaction(fn)`.
- Callers (`apps/local-guest/src/fixture.ts`, `apps/local-owner/src/local-owner-environment.ts`, tests) still hold a `DatabaseSync`. Wrap it at the call site with `NodeSqliteDatabase`. Add a constructor or factory to 02a's module that wraps an existing `DatabaseSync` without taking ownership, so the shared connection stays shared.
- Where a row read is touched, narrow it with a small guard instead of an `as` cast (coding standards). Don't rewrite reads you don't otherwise touch.
- Keep the `databasePath` constructor arguments for now. Slice 02d removes them everywhere at once.

## Out of scope

- `SqliteAvailabilityStore` and `SqliteGuestInteractionStore` (02c), the operator stores (02d), and the app-layer files (02e).
- Behaviour changes of any kind.

## Acceptance criteria

- AC1: None of the seven files imports `node:sqlite`. A test reads the files and asserts this, so a regression fails.
- AC2: The `booking-state` transition still rolls back atomically. Failure path: a throw inside the transition leaves the previous state, tested through the port.
- AC3: The full existing suite passes unchanged (`npm test`), and `npm run check` is clean.

## Tests

Add `test/sql-port-store-imports.test.ts` with AC1; slices 02c, 02d and 02e will extend its file list. Add the AC2 rollback test next to the existing booking-state tests.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0044 / 0046 | Atomic booking and payment transitions | `booking-state.ts` transaction |
| 0090 | Receipt behaviour unchanged | `manual-transfer.ts` (the type swap only) |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments
