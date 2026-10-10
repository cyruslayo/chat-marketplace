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

## Comments

## Answer

Agent part done on `infra/cf-16-migration` (implementation commit `fa606e5`). Status stays `ready-for-human`: the runbook needs the user's review (AC4), and the production cutover and its log are human steps.

### What was built

- **Canonical format** (`packages/platform-core/src/data-migration.ts`): sorted-key JSON lines, BLOBs as `{"$bytes": base64}`, sorted lines, and a table checksum that is SHA-256 of that content. Receipt bytes leave their rows (legacy inline bytes and 07a blob-table bytes both), and a receipt row whose bytes are missing fails the export closed.
- **Import** (`apps/cloudflare/src/ops-import.ts`, `POST /_ops/import`): one transaction per batch. Statements are split to at most 100 bound parameters. Tables and columns come from the target's own schema, and unknown ones are refused (400). Rows upsert on primary key. A malformed row, or any constraint failure, rolls back the whole batch (422, nothing written).
- **Verify and reverse export** (`GET /_ops/import/verify`, `GET /_ops/export?table=`): both behind the 11a layers, read-only, and neither writes audit rows, because `audit_log` is itself compared.
- **Node CLI** (`scripts/export-node-sqlite.ts`): `--export` (read-only source), `--import` (Node target), `--push` and `--pull` (reuse the 11b ops client, secrets from env only), `--compare`. It prints counts only (ADR 0075).
- **Runbook** (`docs/runbooks/cloudflare-cutover.md`): marked DRAFT. It covers freeze, export, R2 receipts, import, verify, Paystack callback and webhook URLs, DNS, smoke tests, a defined rollback with reverse export, and the cutover log.

### Acceptance criteria

- AC1: `apps/cloudflare/test/data-migration.spec.ts` "16 AC1 ..." exports a populated source object, imports it through `/_ops/import` into a second object, and checks every table against the manifest with `compareMigration`. `test/export-node-sqlite.test.ts` "16 AC1 ..." does the same for a Node SQLite file.
- AC2: "16 AC2: a batch that would exceed 100 parameters is split automatically" (60 rows, 2 columns, more than one statement, max 100 parameters). "16 AC2: a malformed row fails its whole batch ..." checks that nothing is written.
- AC3: "16 AC3: importing the same batch twice does not duplicate rows".
- Refusals: "16 import refuses unknown tables and unknown columns and requires both authentication layers". Reverse export: "16 reverse export returns the rows the import wrote ...". Push and pull: three Node tests.
- AC4: not met by the agent (needs user review). Runbook is a draft.
- AC5: see the results below.

### Verification (commit `fa606e5`)

- `npm run check`: exit 0. Four `tsc` programs and the worker bundle guard pass.
- `npm run test:workers`: 12 files, 56 of 56 tests pass (includes the 6 new workerd tests).
- `npm test`: exit 1. Phase 1 is 1396 of 1397 passing. The one failure is `AC2: npm run check type-checks both the Node tree and apps/cloudflare with their own types` (`test/cloudflare-harness.test.ts`). It asserts that `apps/cloudflare/tsconfig.json` lists the workers types, but that file has `types: ["node"]` on the base commit too, so it predates this slice. Phase 2 is 163 of 166 passing. Two browser tests failed in the full run under load (`AC5 (browser) ... View apartment` and `RB9`). Run alone, `guest-discovery-consistency-chromium` and `guest-real-browser-cross-tab` pass 20 of 20, and neither imports code from this slice.

### ADR constraints and where they are reflected

| ADR | Constraint | Where |
| --- | --- | --- |
| 0045 / 0089 | No money evidence lost | Per-table checksums and row counts (`compareMigration`, `--compare`). Batches are atomic. A receipt with missing bytes stops the export. |
| 0090 | Receipts only in private R2, and rows keep no bytes | `buildExport` moves bytes to `receiptBytes` and sets `bytes: null`. Import restores receipts to the blob table on the Node side. The runbook uploads by key to the private bucket. |
| 0075 | No personal data in logs, opaque keys | CLI and route messages carry counts, table names and row positions only. Receipt keys are UUIDs and are checked before use as file names. |
| 0095 | Durable Object SQL, synchronous transactions, 100-parameter limit | `importBatch` uses `transaction` (`transactionSync` on the object) and splits statements to at most 100 parameters. |

### Deviations and questions for the user

1. **Target schema before import (blocker for cutover).** Import refuses an unknown table. The object creates its tables only when its stores are constructed, so a fresh production object may not have every table. The workerd test copies the source DDL into the target. Decide how the production object gets its full schema before the import. Not built here.
2. **Export scope.** `EXPORT_TABLES` (12a) lists evidence tables only. The cutover export covers every application table in the Node file, so that guest, operator and session state is not left behind. Confirm this.
3. **Batch bounds.** The import route reuses the 11b 5 MiB limit for a batch body. `MIGRATION_BATCH_ROWS = 100` is a client chunk size, not a policy value. Confirm both.
4. **Upsert on re-import.** A re-import overwrites existing row values with the file's values. The alternative is to keep the existing row. Confirm the intent.
5. **AC1 harness.** A workerd test cannot open `node:sqlite`, so the workerd AC1 populates a source object through the real stores and migrates object to object. The Node-file half runs in Node. A literal Node-file-to-object test is not possible in this harness. The runbook's `--compare` gate and the staging rehearsal (issue 15) cover the cross-runtime step.
6. **Rollback limits.** Reverse export finds added and changed rows only. Deleted rows after cutover are not detected, because there are no tombstones. The runbook calls this out and points to point-in-time recovery (12b) and the daily export (12a).
7. **Audit.** Import, verify and export write no audit rows, since `audit_log` is compared. Confirm whether reads should be audited some other way (ADR 0075).
8. **Pre-existing failure.** `test/cloudflare-harness.test.ts` (AC2) fails on the base commit. Decide whether to fix it in `apps/cloudflare/tsconfig.json` or change the test. Not touched here.

### Human steps outstanding

- User reviews `docs/runbooks/cloudflare-cutover.md` and answers the open decisions (AC4).
- Staging rehearsal (issue 15) with these steps and checksums matched.
- Production cutover, with the log table in the runbook filled in (AC4). Real-person data must wait for the ADR 0095 gates.

### Files

- `packages/platform-core/src/data-migration.ts` (new)
- `apps/cloudflare/src/ops-import.ts` (new), `apps/cloudflare/src/ops-routes.ts`, `apps/cloudflare/src/shortlet-pilot-do.ts`
- `apps/cloudflare/test/data-migration.spec.ts` (new), `apps/cloudflare/test/data-migration-fixtures.ts` (new), `apps/cloudflare/test/ops-restore.spec.ts`
- `scripts/export-node-sqlite.ts` (new), `test/export-node-sqlite.test.ts` (new)
- `docs/runbooks/cloudflare-cutover.md` (new, DRAFT)
