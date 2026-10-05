# Move the app layer onto the port; guard `node:sqlite` imports

Status: ready-for-agent
Type: task
Blocked by: 02b, 02c, 02d
Branch: `infra/cf-02e-app-layer`
Requested: 2 Oct 2026
Unlocks: 04a, 04b

## Why

After 02b–02d, the domain is on the port. Six app-layer files still use `DatabaseSync` directly, and several open extra connections the PRD missed. This slice finishes the move and adds a guard, so that weekly merges from `main` can't quietly add a new direct use.

## What to build

| File | Today | Change |
| --- | --- | --- |
| `apps/local-guest/src/fixture.ts` | opens `DatabaseSync` (:260), sets pragmas (:261–262); `LocalBookingContractRepository` uses `BEGIN IMMEDIATE` (:178) | open with `openNodeSqliteDatabase`; the repository takes `SqlDatabase` and uses `transaction` |
| `apps/local-owner/src/local-owner-environment.ts` | opens `DatabaseSync` (:428) with busy_timeout (:429), but **no** `foreign_keys` | open with `openNodeSqliteDatabase`, which now also turns on `foreign_keys` (see AC3) |
| `apps/pilot/src/notifications/pilot-notifier.ts` | opens its own connection (:123) and pragma (:124) | take the shared `SqlDatabase` |
| `apps/pilot/src/local-pilot.ts` | opens connections at :49 and :57 | use `openNodeSqliteDatabase`, or take a handle |
| `apps/pilot/src/pilot-server.ts` | healthcheck opens a new connection per call (:29) | `SELECT 1` on a handle passed in; full in-process dispatch is 08c |
| `apps/pilot/src/local-pilot-server.ts` | healthcheck (:60) | same |

Steps:
- After the change, `packages/platform-core/src/node-sqlite-database.ts` is the only production file that imports `node:sqlite`. Tests may still import it.
- Extend `test/sql-port-store-imports.test.ts` into a repo-wide guard: walk `apps/`, `domains/` and `packages/`, and fail if any `.ts` file other than the adapter imports `node:sqlite`.

## Out of scope

- Injecting the database into the environments' config (04a, 04b). This slice only changes **how** they open it.
- Replacing the proxy (08c).

## Acceptance criteria

- AC1: Only `node-sqlite-database.ts` imports `node:sqlite` in production code. Failure path: the guard test fails, naming the file, when a direct import is added.
- AC2: No component opens a second connection to the pilot database. Failure path: a test counts `openNodeSqliteDatabase` and `DatabaseSync` calls during `startPilotServer` and expects exactly one per process.
- AC3: The owner environment now enforces foreign keys, the same as the guest environment. Failure path: a dangling reference insert is refused. **If** an existing owner fixture breaks because of this, stop. Record the failing relation in `## Comments` and ask before you either fix the data or turn the pragma off for owner.
- AC4: The healthcheck reuses the shared handle and still answers `/healthz` 200, or 503 when the database is closed.
- AC5: `npm run check` and the full `npm test` pass, including `test/pilot-local.test.ts` and `test/pilot-production-composition.test.ts`.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0004 | One system of record and one handle | all six files |
| 0079 | Notifications deduplicated durably | `pilot-notifier.ts` keeps its tables on the shared handle |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments

- 5 Oct 2026 integration inventory: Guest Account delivery adds `domains/shortlet/src/guest-account-authority.ts`, which imports `DatabaseSync` and optionally takes a shared Node handle, like the session authorities. Its tables now also include atomic email-command receipts (ADRs 0072/0075/0093). Wave 1 does not migrate this authority. Before this slice's AC1 can pass, convert that boundary to `SqlDatabase` and preserve code consumption, quota writes, session expiry/revocation, email-change receipts and replay authorization with `test/guest-account-authority.test.ts`; the repo-wide import guard must include it. Do not exempt the new file or claim the existing seven-store list covers it.
