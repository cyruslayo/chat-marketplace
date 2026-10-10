# Data migration and cutover

Status: ready-for-human
Type: task
Blocked by: 15
Branch: `infra/cf-16-migration` (into `main`, after 15 has merged the integration branch)
Requested: 2 Oct 2026
Unlocks: 17

## Why

If the Node pilot holds live data, it must move to the Durable Object without loss. Then traffic moves over with a defined rollback window.

## What to build (agent)

- **Exporter:** `scripts/export-node-sqlite.ts` reads the Node SQLite file into per-table JSONL, with row counts and a SHA-256 per table. BLOB receipts are written as separate files and uploaded to R2 by key. Their rows get an `object_key`, and `bytes` is set to NULL (07a's schema).
- **Import route:** `/_ops/import`, behind 11a's authentication, takes a table name and a batch of rows. Inserts are batched so that no statement binds more than 100 parameters, and each batch runs in one transaction. It refuses unknown tables or columns, and it is idempotent per primary key.
- **Verification:** `/_ops/import/verify` returns row counts and checksums per table, which the exporter compares.
- **Runbook:** `docs/runbooks/cloudflare-cutover.md`:
  1. Freeze Node writes (maintenance page).
  2. Export, import and verify.
  3. Update the Paystack dashboard callback and webhook URLs if the origin changes.
  4. Switch DNS.
  5. Run the smoke tests.
  6. Rollback: DNS back to Node, plus a reverse export of anything written after cutover (define how).

## What to do (human)

Run the runbook in production, and record each step with its time and result.

## Acceptance criteria

- AC1: In a test, exporting a populated Node database and importing it into a workers Durable Object gives identical row counts and checksums for every table.
- AC2: A batch that would exceed 100 parameters is split automatically. Failure path: a malformed row fails its whole batch, and nothing from that batch is written.
- AC3: Importing the same batch twice does not duplicate rows.
- AC4: The runbook, including rollback, is reviewed by the user before cutover, and the cutover log is recorded below.
- AC5: `npm run test:workers`, `npm test` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0045 / 0089 | No money evidence lost | checksums |
| 0090 | Receipts preserved | BLOB → R2 |
| 0075 | No personal data in logs during migration | exporter output only to files and R2 |

## Decisions (delegated by user, 10 Oct 2026)

The user delegated these to the parent agent on 10 Oct 2026. Each has a rationale, the code or runbook that applies it, and its tests. Principles used throughout: no hidden dependencies, explicit state over convention, fail closed. Items that need a human fact are listed under "Needs user" and are not decided here.

### D1. Re-import: upsert on primary key, then a one-way cutover flag

- **Decided:** the import upserts by primary key while migration mode is on. A one-way flag, `migration_state.cutover_completed_at`, is set only by the authenticated `POST /_ops/cutover/complete` (idempotent: a second call returns the first timestamp). While the flag is set, every import is refused with `CUTOVER_COMPLETE` (409) before any write. Control tables (`schema_migrations`, `migration_state`) are not application tables, so an import names them as `UNKNOWN_TABLE` (400). No route clears the flag.
- **Rationale:** the upsert keeps repeated pushes safe (AC3). Making the end of migration an explicit, recorded event removes the convention "stop pushing after cutover". A flag that import can write would let import undo the cutover, so import cannot reach it.
- **Code:** `packages/platform-core/src/data-migration.ts` (`completeCutover`, `cutoverCompletedAt`, `CONTROL_TABLES`); `apps/cloudflare/src/ops-import.ts` (`assertMigrationOpen`); `apps/cloudflare/src/ops-routes.ts` (cutover route).
- **Tests:** `apps/cloudflare/test/data-migration.spec.ts`: "16 D1: a re-import overwrites a changed row...", "16 D1: an import is refused with CUTOVER_COMPLETE...", "16 D1: the cutover flag cannot be unset, overwritten or read back through import".

### D2. Limits: rows per request are derived per table; the 5 MiB bound is a documented chunk size

- **Decided:** `MIGRATION_BATCH_ROWS = 100` is removed. A table's request holds `migrationBatchRows(columns) = floor(MAX_STATEMENT_PARAMETERS / columns)` rows. The Worker splits its statements by the same rule. `MAX_STATEMENT_PARAMETERS = 100` is kept, with a comment saying the figure is from the Cloudflare Durable Object limits page as reported by a search summary, not re-read; the runbook checklist item C1 verifies it against the live page before cutover. `MAX_IMPORT_REQUEST_BYTES = 5 MiB` is kept as a transport chunk size, named and documented in `data-migration.ts`. The client enforces it (`importRequestChunks`), and the Worker enforces it before it reads the body. A single row larger than the bound is refused with its table and position named, never its content (ADR 0075).
- **Rationale:** a per-table derivation ties the request size to the real limit, not to a magic row count. The byte bound is a chunk size, not a booking or cost policy, so it is documented as such rather than presented as one.
- **Tests:** `test/export-node-sqlite.test.ts`: "16 D2: push sends each table in requests of floor(100 / column count) rows...", "16 D2: push keeps each request body within the 5 MiB chunk bound...". `apps/cloudflare/test/data-migration.spec.ts`: "16 D2: an import request over the 5 MiB chunk bound is refused before its rows are read".

### D3. Schema: versioned ordered migrations, one path for fresh and migrated installs

- **Decided:** `apps/cloudflare/src/schema.ts` lists ordered migrations. Migration 1 is the baseline: the DDL each store owns, exported from its module and also run by that store's constructor, so nothing is copied. It covers every table the Node composition creates, except `receipt_blobs` (its bytes move to R2). Migration 2 creates the cutover flag table. `applySchemaMigrations` (`packages/platform-core/src/schema-migrations.ts`) records each version in `schema_migrations`, refuses a database that is ahead of the code, and refuses gaps. The Durable Object applies the migrations in its constructor through `blockConcurrencyWhile`. A Node file is migrated by `--migrate`, the same function. Import checks the schema version first: a mismatch is refused with `SCHEMA_NOT_READY` (409), and nothing is created.
- **Why extend rather than reuse:** the existing schema did not work this way. Each store ran `CREATE TABLE IF NOT EXISTS` when it was constructed, so the object had a table only after its store was built. That path is kept (same SQL, idempotent) so Node and the existing tests are unchanged. The legacy `ALTER` steps in the guest store and the receipt-table rebuild stay for old Node files.
- **Tests:** `test/schema-migrations.test.ts` (5 tests); `apps/cloudflare/test/data-migration.spec.ts`: "16 D3: an import into an object whose schema version is behind is refused...", "16 D3: a new object records every migration once, in order...", "16 D3: every application table the fixture's stores create is created by the migrations"; `test/export-node-sqlite.test.ts`: "16 D3: importing into a Node file whose schema has not been migrated is refused...".
- **Known gap:** the table-coverage test checks only the tables the synthetic fixture's stores create. It does not construct every store of the production composition, so a store the fixture does not build could be missing from the baseline. The import would refuse such a table (`UNKNOWN_TABLE`) and push nothing, but a full-composition check is still to write.

### D4. Freeze and rollback

- **Decided:** no code change for read-only mode. The Node pilot has no clean seam: its timers write without any request (the notification sweep, `DEFAULT_NOTIFICATION_SWEEP_SECONDS` = 30 s by default), so a request guard would not stop writes. The freeze is specified in runbook step 1 as a process stop, with a verification command: `pgrep` must print nothing, and the database and `-wal` checksums must be the same after two sweep intervals. Node data is untouched through the window. Issue 17 runs only after the window closes.
- **Rollback window:** `ROLLBACK_WINDOW` in the runbook is the single definition. It is 14 days after the cutover flag is set. It closes only when at least 14 days have passed and at least one full payout cycle and one verified restore from the daily export (12a, read back through 12b) have completed on Cloudflare with no discrepancy in the post-cutover checks. Otherwise it extends. Issue 17 runs only after it closes. The runbook adds a post-window reconciliation step (step 10) because deletes are not visible in a reverse export, and that drift grows with the window's length.

### Other open decisions (status)

1. **Target schema:** decided by D3.
2. **Export scope:** decided. Export every application table, so no guest, operator or session state is left behind. Exceptions: `receipt_blobs` (moved to R2) and control tables (never exported). Checklist C2 covers the local-only table.
3. **Batch byte bound:** decided by D2. The 5 MiB bound is a documented chunk size, enforced by the client and the Worker.
4. **Upsert on re-import:** decided by D1. Confirmed as intended, until the flag is set.
5. **Freeze mechanism, Worker route and DNS TTL:** the freeze is decided (D4: process stop, verified). The edge maintenance page, the route and the TTL are **Needs user**.
6. **Receipt upload:** decided. `cf r2 objects put` with `--file`, `--content-type`, `--bucket-name` and `--mode production`; the flags were checked against the pinned CLI's help. The CLI's authentication is **Needs user**.
7. **Data-protection gates (ADR 0095):** **Needs user**. Counsel, transfer basis, vendor terms and DPIA block any run on real data.
8. **Receipt download (R4):** decided. Shell redirection of the raw bytes: `cf r2 objects get --help` says the body is written as raw bytes unless `--text` is given. The checksum against the manifest is the gate. Checklist C4 confirms it with a synthetic receipt on staging before production.
9. **Post-cutover deletes:** decided. R3 adds a removed-rows comparison (`comm -23`) against the cutover export, and R4 reports removed receipt keys. Any removal stops the rollback until a person reviews it. Step 10 reconciles deletes against the daily export after the window.

### Values from the earlier question list

- Item 1 (`MAX_IMPORT_BATCH_BYTES`): decided by D2. Kept as 5 MiB, named `MAX_IMPORT_REQUEST_BYTES`, documented as a chunk size.
- Item 2 (rows per request): decided by D2. Derived per table, so 100 is no longer a row count.
- Item 3 (`MAX_STATEMENT_PARAMETERS`): kept. It is sourced from a search summary and listed as checklist C1 to verify against the live page.

## Needs user

These need human facts or decisions. None is decided in this issue.

1. The production Cloudflare account, the `cf` authentication profile, and the Access service token. No values belong in the repository.
2. The data-protection gates in ADR 0095 (counsel, transfer basis, vendor terms, DPIA). They block any run on real data.
3. The edge freeze page (its mechanism and wording). The process stop applies either way.
4. The Worker route, the DNS record and the TTL.
5. The go or no-go for cutover, and the sign-off of the runbook (AC4).

## Values to ask the user (superseded)

The three questions below were answered in the Decisions section above. Kept for the record.



1. **Import batch byte bound.** `MAX_IMPORT_BATCH_BYTES` in `apps/cloudflare/src/ops-routes.ts` reuses the 5 MiB inventory
   CSV limit from 11b. No ADR or issue sets a value for JSON import batches. Confirm it, or set another.
2. **Rows per request.** `MIGRATION_BATCH_ROWS = 100` in `packages/platform-core/src/data-migration.ts` is the client's
   chunk size. The issue fixes the 100-parameter statement limit, not the row count per request. Confirm 100 or set another.
3. **Not asked (sourced).** `MAX_STATEMENT_PARAMETERS = 100` is the Cloudflare Durable Object limit, as recorded in
   `.scratch/cloudflare-deployment/PRD.md` (Durable Object limits) and `apps/cloudflare/src/do-sql-database.ts`. The live
   Cloudflare page was not re-read in this pass.

## Open decisions for the user (superseded: see Decisions above)

These mirror the "Open decisions for the user" section of `docs/runbooks/cloudflare-cutover.md`, which is still a DRAFT.

1. **Target schema.** `--push` refuses a table the object does not have, and the object creates its tables only as its
   stores are constructed. Decide how the production object gets every table before the import.
2. **Export scope.** The cutover export covers every application table in the Node file, not only the `EXPORT_TABLES`
   evidence set in 12a. Confirm.
3. **Batch byte bound.** See "Values to ask the user", item 1.
4. **Upsert on re-import.** A re-import overwrites a stored row with the file's values. Confirm that is intended.
5. **Freeze mechanism, Worker route and DNS TTL.** The user chooses these.
6. **Receipt upload.** The runbook now uses `cf r2 objects put` (remote, `--mode production`). Confirm the command and
   its authentication before the first real upload.
7. **Data-protection gates (ADR 0095).** No production or real-person data may be migrated until counsel approves the
   cross-border transfer basis, the vendor terms and the DPIA. Staging uses synthetic data only. This blocks the run,
   not only the sign-off.
8. **Receipt download (runbook R4).** `cf r2 objects get` in the pinned beta has no documented file-output option. The
   runbook marks this as a documented gap. Confirm the method.
9. **Post-cutover deletes.** The rollback's R3 comparison finds added and changed rows only. Decide how deletes after
   cutover are checked before R5.

## Comments

### Agent pass on `infra/cf-wave6` (10 Oct 2026)

Status unchanged: **ready-for-human**. Nothing here is a cutover, a production run or a resolution.

- **Branch.** `infra/cf-wave6` was cut from `origin/infra/cloudflare-deployment`, and `origin/infra/cf-15-staging-prep`
  and `origin/infra/cf-16-migration` were merged with merge commits. Both merged without conflicts. The integration
  branch carries ADR 0095 (`docs/adr/0095-host-the-pilot-on-cloudflare.md`); `main`'s `docs/adr/` stops at 0091.
- **AC1 (identical counts and checksums).** Now covered end to end. The Node exporter's output for the synthetic source
  is committed as `apps/cloudflare/test/fixtures/node-export.json`. A Node test regenerates it byte for byte, and the
  Workers test "16 AC1 (end to end)" imports it through `POST /_ops/import` and compares every table with the manifest.
  Regenerate with `UPDATE_NODE_EXPORT_FIXTURE=1` when the exporter or schema changes.
- **AC2 and AC3.** The existing split, refusal and repeat-import tests pass unchanged.
- **ADR 0075 (malformed rows must not be echoed).** Two leaks were real. V8's `JSON.parse` message quotes part of its input.
  `readRows` in `scripts/export-node-sqlite.ts` sent that message to the console. `readJsonBody` in `ops-routes.ts`
  returned it in the 400 body. Both now return a fixed message naming the table and line, or saying the body is not
  JSON. Failing-first tests are "16 ADR 0075: ..." in `test/export-node-sqlite.test.ts` and
  `apps/cloudflare/test/data-migration.spec.ts`.
- **Runbook (`docs/runbooks/cloudflare-cutover.md`).** The `wrangler r2` suggestion is now `npm exec cf -- r2 objects put`
  and `r2 objects list`. The download step is a documented gap (open decision 8). The runbook stays DRAFT.
- **Stale reference.** The `ops-routes.ts` comment pointed to a non-existent "Answer". It now points to "Values to ask the
  user". The 100-parameter constant now cites the Cloudflare Durable Object limits page, and `PRD.md` records it.
- **Bundle (e, report only).** Rebuilding `apps/local-guest/src/client.ts` with the same esbuild options matches commit
  `803d616`'s `dist/client.js` except for 50 path comments. They name `../chat-marketplace-cloudflare/node_modules/...`,
  which is another checkout. Functionally the bundle is identical. The suite's build step rewrites this file.
  **Correction (wave-6 fix pass):** the pass-1 wording said the file was not in these commits. It was: `dist/client.js`
  was in the branch diff against `origin/infra/cloudflare-deployment`, carrying the other checkout's paths. The fix pass
  reverts it to the `origin/infra/cloudflare-deployment` version. Any test run rewrites it, so restore it afterwards.
- **Checks.** `npm run check` exits 0. `npm run test:workers` passes 58 of 58 across 12 files. The non-browser suite
  (phase 1 of `npm test`, reproduced because `package.json` has no `test:non-browser` script) gives 1407 tests: 1404 pass
  and 3 fail. The browser phase was not run.
- **The 3 failures are not from the merge.** They fail the same way on `origin/infra/cloudflare-deployment` before the
  merge:
  1. `test/cloudflare-harness.test.ts` AC2 expects the Workers types in `apps/cloudflare/tsconfig.json`, which is `["node"]` since 10b.
  2. `test/complete-a-same-day-booking.test.ts` AC 2 expects a rejection at 12:30 on 22 July 2026 and gets none.
  3. `test/move-guest-verification-to-checkin.test.ts` AC22 greps `process.env` names for `/NIN/`. In this sandbox
     `CLAUDE_CODE_BG_TASKS_REPORT_RUNNING` matches, so the test fails here. The regex also matches "RUNNING".
  None is fixed here. Each needs a decision on the test's intent, and AC5 (`npm test` green) is not met until they are.
- **Untracked files.** The non-browser suite left `.scratch/eval-test/`, `.scratch/local-guest/` and `.scratch/local-owner/`
  (SQLite files). They are not committed. Removing them was denied, so they remain in the working tree.

### Agent pass 2 on `infra/cf-wave6` (10 Oct 2026)

Status unchanged: **ready-for-human**. Nothing here is a cutover, a production run or a resolution.

- **Decisions.** D1 to D4, the rollback window and the other open decisions are recorded above under "Decisions (delegated by user, 10 Oct 2026)". The window is 14 days and closes only on the two conditions in the runbook's `ROLLBACK_WINDOW` section. The runbook also gained a post-window reconciliation step (step 10) and a removed-row check in R3.
- **Implemented.** A migration runner with `schema_migrations` (`packages/platform-core/src/schema-migrations.ts`) and the ordered migrations in `apps/cloudflare/src/schema.ts`. The store DDL moved to exported constants that the stores and the migrations both use (no copies). The Durable Object applies the migrations in its constructor. The cutover flag and `POST /_ops/cutover/complete`. Import checks the schema and the flag before any write (409 `SCHEMA_NOT_READY` and `CUTOVER_COMPLETE`). The client chunks by `floor(100 / columns)` and by a documented 5 MiB request bound. The Node `--migrate` and `--cutover-complete` commands.
- **Failing-first, honestly.** The new tests were written before the implementation. I did not capture a separate red run, so the red state is not in this log. The upsert test ("16 D1: a re-import overwrites...") pins behaviour that already existed.
- **Checks.** `npm run check` exits 0. `npm run test:workers` passes 65 of 65 across 12 files (58 before this pass, plus seven new). The non-browser phase 1 (reproduced from `scripts/run-tests.mjs`) gives 1417 of 1417 pass, 0 fail (1407 tests with 3 failures in the previous pass). The browser phase was not run. `apps/local-guest/dist/client.js` was restored after each test run. No untracked files remain beyond the three new sources.
- **Known gap.** The table-coverage test checks only the tables that the synthetic fixture's stores create. It does not construct every store of the production composition, so a missing baseline table would show up only as a refused import. A full-composition check is still to write.
- **Remains.** Checklist items C1 (`MAX_STATEMENT_PARAMETERS` against the live page), C4 (receipt download on staging), C5 (`cf r2 objects list` flags) and C6 (ADR 0095 gates, **Needs user**). Step 10 needs the daily export's layout confirmed against 12a and 12b. Needs user: the Cloudflare account and `cf` profile, the edge freeze page, the Worker route and TTL, the go or no-go, and the runbook sign-off (AC4). The cutover log is empty, as it should be.

### Agent pass 3 on `infra/cf-wave6` (10 Oct 2026)

Status unchanged: **ready-for-human**. Nothing here is a cutover, a production run or a resolution.

- **Full-composition table coverage (closes the known gap in D3).** `apps/cloudflare/test/production-composition.spec.ts`
  builds the production composition in a fresh Durable Object (provisioning, a served request and an authenticated ops
  request) and reads the tables it creates from live SQLite. Three checks: every created table is created by the migrations;
  every application table is on the import/export allowlist (`GET /_ops/import/verify`) or excluded with a reason; every
  application table is in the 12a daily export set (`EXPORT_TABLES`) or excluded with a reason. The red run was taken by
  omitting `OPERATOR_SESSION_SCHEMA` from the baseline: the first check failed by name (`operator_sessions`,
  `operator_access_tokens`). The schema was restored. A second probe that omitted `BOOKING_STATE_SCHEMA` failed the same check
  for `booking_contracts` and `booking_reservations`, so the probe reaches the booking stores. No migration gap was found:
  the composition creates 50 application tables, and the baseline covers all 50 (`local_pilot_clock` is Node-only and is
  checklist C2; `receipt_blobs` is excluded by design).
- **Daily export coverage (finding).** The 12a export set covers 18 of the 50 application tables. The other 32 are listed
  with reasons in `DAILY_EXPORT_EXCLUDED`, including the revenue ledger, `units`, `operators` and `guest_accounts`. Step 10 of the
  runbook can reconcile only the 18. Needs user item 6 in the runbook asks for the decision.
- **Runbook step 10.** Rewritten to the layout 12a actually writes: `EXPORTS` key `YYYY-MM-DD/<table>.jsonl` (Lagos date),
  raw `JSON.stringify` lines in rowid order (not the canonical pull format), no checksums or manifest, one export per
  Lagos day at the first alarm of the day, `manual_transfer_receipts` projected to five columns. The old step compared
  "table checksums" that do not exist. Checklist C7 covers the R2 download method, as C4 does for receipts.
- **Checks.** `npm run check` exits 0. `npm run test:workers` passes 68 of 68 across 13 files (65 before, plus three). The
  non-browser phase 1 gives 1417 of 1417 pass, 0 fail.
- **Test helper.** `provisionTenant` in `ops-test-helpers.ts` now takes the stub, so the new spec provisions an object that no
  other test has built. The default is unchanged.

### Agent pass 4 on `infra/cf-wave6` (10 Oct 2026): export coverage decided, restore and cutover order corrected

Status unchanged: **ready-for-human**. Nothing here is a cutover, a production run or a resolution.

- **Export scope (Needs user item 6, now decided).** The daily export covers every application table except the five bearer-credential tables in `DAILY_EXPORT_EXCLUDED` (`apps/cloudflare/src/do-export.ts`), each with its ADR. Details, the personal-data list for the DPIA, the bounds and the retention-listing fix are in the issue 12a comment. The cutover runbook's step 10 and its Needs-user item 6 are updated to match. The five exclusions and the choice to include `guest_contacts` are for review at the sign-off (AC4).
- **Cutover push order (new finding, fixed).** The object enforces foreign keys, and `buildExport` listed tables alphabetically. The push sends the manifest's tables in that order, so `guest_account_email_commands` (and `guest_account_sessions` and `guest_sign_in_codes`, which are excluded from the export) would have been refused before `guest_accounts`, for any tenant with a guest account. `buildExport` now lists tables with `importOrder()`, parents first. Tests: "16 D1 cutover: the manifest lists each parent table before the tables that reference it..." in `test/export-node-sqlite.test.ts` (seen failing with the old order). The committed fixture is unchanged, because the synthetic source has no foreign-key children.
- **Restore runbook.** Section 2 is corrected (see the issue 12b comment). The restore test loads a day's files parent-first through `POST /_ops/import` and checks that the rebuilt object exports the same bytes for every exported table.
- **Chrome path.** `test/helpers/chrome-devtools.ts` reads `SHORTLET_CHROME_PATH` (blank means the default) and adds `--no-sandbox` only when `SHORTLET_CHROME_NO_SANDBOX=1`, through `resolveChromeLaunch`. The test is `test/chrome-devtools-config.test.ts`.
- **Checks.** `npm run check` exits 0. `npm run test:workers` passes 72 of 72 across 14 files (68 before this pass, plus four new tests). The non-browser phase (phase 1 of `npm test`, reproduced because `package.json` has no separate script) gives 1423 of 1423 tests passing, 0 failing. The browser phase was not run.
- **Open.** C1, C4, C5, C6 and C7 are unchanged. The runbook sign-off (AC4) and the edge freeze, route and DNS items remain Needs user. Also open: the DPIA entries for the personal-data columns, and the ADR 0075 transient and 180-day classes (provisional) against the 400-day export retention.

## Commits on `infra/cf-wave6`

`16f5d28` ADR 0075 fixes with tests, `7bea2c7` comment and citation fixes, `19a833f` Node fixture end-to-end test,
`2aba2ef` runbook `cf` commands, `1dc20b7` `*.json?raw` declaration. The merge commits are `b567a0b` (cf-15) and `e3a52a0`
(cf-16).

