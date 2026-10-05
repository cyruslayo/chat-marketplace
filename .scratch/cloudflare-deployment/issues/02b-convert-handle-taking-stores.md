# Move the seven handle-taking stores onto `SqlDatabase`

Status: resolved
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

- Selected after 02a was merged; branch cut from the integration branch after validated 03a delivery. Keep this slice to seven stores and required callers. Guest Account authority remains explicitly in 02e's persistence inventory, not exempted from its future import guard.

### ADR implementation plan

| ADR | Constraint | Acceptance / code path |
| --- | --- | --- |
| 0004 / 0095 | Shared synchronous backend authority; transactions cannot await | All seven constructor types; Node borrowed-handle adapter |
| 0044 / 0046 | Atomic payment/booking transition; preserve one live attempt | AC2 booking-state save transaction, including existing outer transactions |
| 0090 / 0075 | Receipt evidence/storage/access unchanged; no credentials in logs | manual-transfer type swap, existing receipt tests; no new logging |
| 0032 | Preserve 11:00 WAT checkout retention anchor | Existing receipt-retention branch restated without nested ternary; unchanged UTC timestamp |
| 0089 | Owner payable captured and ledger stays authoritative | owner-payable type swap only |
| 0092 | Period payments reuse payment transitions; do not activate counsel-gated behavior | Booking snapshots unchanged, no extended-stay logic changed |

- Read the ADRs above and Shortlet/Platform CONTEXT.md. No policies changed; transaction callsite cites non-obvious nesting constraint. Borrowed handles must not set pragmas, close the connection or commit a caller-owned transaction.
- Guest Account inventory: also read ADRs 0072/0093/0094 and the authority's constructor/schema/transaction body. Its five account/session/code/quota/email-command tables are now explicitly listed in 02e. No account authority conversion or exemptions in this slice.
- Minimal diagnostic reconciliation only: JSON parsing is directly inside existing catches; SQL rows use field guards; ignored calendar callback results are `void`; `#sharedRow` names its record shape; adapter validates its row record before indexed reads. Two pre-existing manual-transfer ternaries were restated as equivalent branches. No suppression comments or policy changes. Active LSP probe found no type errors (existing warnings/hints and silent-on-clean coverage remain).
- Independent source review found no confirmed correctness issue, but could not inspect git diff or rerun checks. Parent inspected actual diffs and ran the checks below; child review was not used as proof.
- One stable full-suite attempt failed the existing Chromium workspace Escape/focus test. Its entire file passed on isolated rerun (43 tests), and a subsequent full stable run passed without source/test changes. No guest UI patch was added to a persistence slice.

## Verification and Definition of Done

1. Separate named tests for AC1 (`test/sql-port-store-imports.test.ts`) and AC2/AC3 (`test/sql-port-booking-state.test.ts`); all three observed failing before implementation. AC3 smoke covers all seven constructors on one borrowed port; full-suite/compiler evidence below completes that criterion.
2. AC2 injects a reservation-insert trigger failure after the contract write: previous contract and absent reservation persist. It also covers failure and success inside a caller-owned transaction, outer rollback and standalone commit. Borrowed close leaves the raw handle usable and borrowed construction leaves foreign keys/busy timeout unchanged.
3. ADR table rechecked: atomic synchronous writes, unchanged payment/receipt/owner semantics, no invented account migration. Callsite and adapter cite the nesting constraint.
4. No unused injected dependency; all shared handles, clocks and test bindings used.
5. No invented policy values; no owner foreign-key setting changed (02e remains responsible for that decision).
6. No bearer credential, account identity, receipt content or financial reference added to logs/audit.
7. `npm run check`, `npm run test:workers` (1 passed), Node SQL contract, focused suites and full `env -u PI_REASONING_LEVEL npm test` passed. Final full suite: **1,268 non-browser tests; 165 browser tests; zero failures; one expected skip**. Log: `/tmp/cf-wave2-02b-clean-tests.log`. The environment-variable caveat is documented in 03a. Whitespace check passed.

### Browser smoke

- Synthetic temporary database, deterministic concierge, separate Chrome context `cf-wave2-synthetic-smoke`, URL `http://127.0.0.1:3047/`.
- Opened home, clicked Explore Lagos and 2 guests: both turn requests returned 200. Opened `/guest/contact`, saved a synthetic Nigerian phone, reloaded: normalized persisted value remained. Contact POST returned 303 and read returned 200; CSS/client/state loaded successfully.
- Console/network inspection: only `/favicon.ico` 404, no failed application/API request or runtime exception. Server, temporary script/database and browser tab cleaned up. Full payment, operator and restart paths are covered by the suite, not this small manual smoke.
- No production Cloudflare assembly/config exists yet; `cf build`, dry-run deployment, runtime spike 01b and DO SQL adapter 03b are not claimed by this slice.

## Answer

Implementation committed in `ca9de39` before resolution. Converted all seven specified stores to `SqlDatabase`, replacing the booking write transaction with `transaction()` and keeping path labels. Existing Node handles are wrapped without opening a connection, changing pragmas or taking ownership. Savepoints preserve both port-owned nesting and existing raw caller transactions. Required guest/owner/notifier/test callers are updated. Guest Account authority stays explicitly inventoried for 02e; the repo-wide import guard is not prematurely claimed.
