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

## Values to ask the user

1. **Import batch byte bound.** `MAX_IMPORT_BATCH_BYTES` in `apps/cloudflare/src/ops-routes.ts` reuses the 5 MiB inventory
   CSV limit from 11b. No ADR or issue sets a value for JSON import batches. Confirm it, or set another.
2. **Rows per request.** `MIGRATION_BATCH_ROWS = 100` in `packages/platform-core/src/data-migration.ts` is the client's
   chunk size. The issue fixes the 100-parameter statement limit, not the row count per request. Confirm 100 or set another.
3. **Not asked (sourced).** `MAX_STATEMENT_PARAMETERS = 100` is the Cloudflare Durable Object limit, as recorded in
   `.scratch/cloudflare-deployment/PRD.md` (Durable Object limits) and `apps/cloudflare/src/do-sql-database.ts`. The live
   Cloudflare page was not re-read in this pass.

## Open decisions for the user

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
  which is another checkout. Functionally the bundle is identical. The suite's build step rewrites this file, so the
  working tree was restored and the file is not in these commits.
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

## Commits on `infra/cf-wave6`

`16f5d28` ADR 0075 fixes with tests, `7bea2c7` comment and citation fixes, `19a833f` Node fixture end-to-end test,
`2aba2ef` runbook `cf` commands, `1dc20b7` `*.json?raw` declaration. The merge commits are `b567a0b` (cf-15) and `e3a52a0`
(cf-16).

