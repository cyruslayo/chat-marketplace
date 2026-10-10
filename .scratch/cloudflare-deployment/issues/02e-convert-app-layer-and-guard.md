# Move the app layer onto the port; guard `node:sqlite` imports

Status: resolved
Type: task
Blocked by: 02b, 02c, 02d
Branch: `infra/cf-02e-app-layer`
Requested: 2 Oct 2026
Unlocks: 04a, 04b

## Why

After 02b–02d, the original domain stores are on the port, but the newly integrated Guest Account authority is not. Six app-layer files and that additional domain authority still use `DatabaseSync` directly, and several open extra connections the PRD missed. This slice finishes the move and adds a guard, so that weekly merges from `main` can't quietly add a new direct use.

## What to build

| File | Today | Change |
| --- | --- | --- |
| `apps/local-guest/src/fixture.ts` | opens `DatabaseSync` (:260), sets pragmas (:261–262); `LocalBookingContractRepository` uses `BEGIN IMMEDIATE` (:178) | open with `openNodeSqliteDatabase`; the repository takes `SqlDatabase` and uses `transaction` |
| `apps/local-owner/src/local-owner-environment.ts` | opens `DatabaseSync` (:428) with busy_timeout (:429), but **no** `foreign_keys` | open with `openNodeSqliteDatabase`, which now also turns on `foreign_keys` (see AC3) |
| `apps/pilot/src/notifications/pilot-notifier.ts` | opens its own connection (:123) and pragma (:124) | take the shared `SqlDatabase` |
| `apps/pilot/src/local-pilot.ts` | opens connections at :49 and :57 | use `openNodeSqliteDatabase`, or take a handle |
| `apps/pilot/src/pilot-server.ts` | healthcheck opens a new connection per call (:29) | `SELECT 1` on a handle passed in; full in-process dispatch is 08c |
| `apps/pilot/src/local-pilot-server.ts` | healthcheck (:60) | same |
| `domains/shortlet/src/guest-account-authority.ts` | path-first constructor (:251), optional `database?: DatabaseSync`, its own busy timeout and `BEGIN IMMEDIATE` helper (:345) | require shared `SqlDatabase`, use `transaction`, preserve non-owning close and all account/code/session/quota/email-command semantics; update server composition and authority tests |

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
| 0072 / 0075 / 0093 | Account commands authenticate and authorize replay; consume codes and record command receipts atomically; never log codes, hashes, sessions or email | Guest Account authority conversion and `test/guest-account-authority.test.ts` |
| 0094 | Account identity anchors assurance; no invented freshness or booking gate | Preserve account identity/lineage while replacing storage boundary only |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments

- Wave 2 inventory (5 Oct 2026, after 02b): seven handle-taking stores are ported. The remaining non-adapter production imports are **five domain authorities/stores** (availability and interaction: 02c; operator grants and sessions: 02d; **Guest Account: 02e**) and **six app files** listed above. The inventory is twelve domain persistence files in total, not the original eleven. Guest Account tables: `guest_accounts`, `guest_account_sessions`, `guest_sign_in_codes`, `guest_account_rate_events`, `guest_account_email_commands`. Preserve refused-check quota writes and wrong-attempt persistence, single-use code consumption, absolute session expiry/revocation, sensitive-action binding and authenticated email-command replay. Interaction-side account links/scoped claims stay in the interaction store and must not be rewritten or inferred from mutable contact (ADRs 0093/0094). This slice is still blocked by 02c/02d; Wave 2 does not implement it.
- 02b names the existing app `LocalBookingContractRepository.#sharedRow` shape as `LocalBookingSqlRow` and preserves both callers' JSON string guards. This repository still uses a raw Node handle and manual transaction; its actual port conversion remains here. Do not weaken its guards or add an import-guard exception.
- 5 Oct 2026 integration inventory: Guest Account delivery adds `domains/shortlet/src/guest-account-authority.ts`, which imports `DatabaseSync` and optionally takes a shared Node handle, like the session authorities. Its tables now also include atomic email-command receipts (ADRs 0072/0075/0093). Wave 1 does not migrate this authority. Before this slice's AC1 can pass, convert that boundary to `SqlDatabase` and preserve code consumption, quota writes, session expiry/revocation, email-change receipts and replay authorization with `test/guest-account-authority.test.ts`; the repo-wide import guard must include it. Do not exempt the new file or claim the existing seven-store list covers it.

- 6 Oct 2026 (Wave 3): **AC2 deviation, recorded for review.** "Exactly one handle per process" cannot hold while the guest and owner environments each open their own handle from a path, and injecting one shared handle is 04a/04b's job (this slice's Out of scope). The AC2 test first asserted the achievable half (two handles, one per environment). **Superseded the same day by 04a/04b:** `startPilotServer` now injects one handle into both environments and the test asserts **exactly one** handle with notifications configured; 04c extends that to per-session runtimes.
- AC3 resolved without a gate: only the Guest Account tables carry foreign keys and no owner fixture writes a dangling reference, so enabling `foreign_keys` on the owner handle broke nothing. The AC3 test inserts a dangling `guest_sign_in_codes.account_guest_id` through the owner environment's handle and expects `FOREIGN KEY` refusal. No decision was needed from the user.
- The guard walks `apps/`, `domains/` and `packages/` and also catches `import("node:sqlite")`.

## Answer

Resolved 6 Oct 2026. All six app files and the Guest Account authority now use `SqlDatabase`; `node-sqlite-database.ts` is the only production importer of `node:sqlite` (repo-wide guard in `test/pilot-database-handle.test.ts`).

- `fixture.ts`, `local-owner-environment.ts`: open with `openNodeSqliteDatabase`; `LocalBookingContractRepository` uses `transaction`; both environments expose a read-only `database` getter and close idempotently. The owner handle now enforces `foreign_keys`.
- `PilotNotifier` takes `database: SqlDatabase` (borrowed; its `close()` is removed). `/healthz` in both pilot servers runs `SELECT 1` on the guest environment's handle through `apps/pilot/src/database-health.ts` and answers 503 once it is closed. `local-pilot.ts` clock helpers use `openNodeSqliteDatabase`.
- `SqliteGuestAccountAuthority` now takes `(database: SqlDatabase, options)`, uses `transaction`, and its `close()` is a documented no-op like the other authorities. All 17 authority tests pass via `openGuestAccountAuthority` / `closeGuestAccountAuthority` helpers; the cross-process verify race test opens its own handle in each child.
- Adapter gained `nodeSqlitePathOpenCount()` so tests can count handles.

ADRs: 0004 (one handle, all files), 0079 (notification tables on the shared handle), 0072/0075/0093 (code consumption, receipts and quota writes unchanged; no secrets logged), 0094 (identity/lineage untouched). Evidence: `npm run check` clean; phase-1 `npm test` 1,323 tests with zero failures once `PI_REASONING_LEVEL` is unset (the one failure with it set empty is the known NIN-environment assertion); browser phase run at wave end.
