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
