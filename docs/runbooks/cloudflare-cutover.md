# Cut over the pilot from Node to Cloudflare (DRAFT)

> **DRAFT. Not approved for use.** The agent drafted this runbook for issue 16. Decisions D1 to D4 and the other open
> decisions were delegated by the user on 10 Oct 2026 and are recorded in `.scratch/cloudflare-deployment/issues/16-data-migration-and-cutover.md`
> under "Decisions (delegated by user, 10 Oct 2026)". Items marked **Needs user** below stay open. The user must still
> review this runbook before anyone runs a step against production (issue 16 AC4). Do not run it with real guest or
> payment data until the data-protection gates in ADR 0095 are cleared (counsel approval of the cross-border transfer
> basis, vendor terms and the DPIA). Staging rehearsal (issue 15) comes first.

The Node pilot keeps one SQLite file (`SHORTLET_DB_PATH`) and its receipts. Cloudflare keeps platform state and shortlet
transactions in separate SQLite-backed Durable Objects; receipts remain in the private `RECEIPTS` R2 bucket (ADRs 0004,
0090, 0095, 0101). This runbook moves the data through the authenticated `/_ops` gateway, switches traffic, and defines
how to go back.

| Authority | Durable Object | Owned migration data |
| --- | --- | --- |
| PLATFORM | `env.PLATFORM.idFromName(SHORTLET_TENANT_ID)` | Guest Accounts, linked principals/claims, contacts, threads, account rate events, audit log and telemetry. |
| SHORTLET | `env.SHORTLET.idFromName(SHORTLET_TENANT_ID)` | Shortlet bookings, payments, operators, units, revenue and `guest_identity_assurance`. |

The gateway routes each table to its owner. Load PLATFORM parents before SHORTLET children; status and verify expose both
authorities. Ownership and assurance placement follow ADR 0101.

Record every step with its start time, end time, result and operator in the log at the end. Do not write secrets,
tokens or guest data in the log. Counts and checksums are enough.

## Rollback window (single named place)

`ROLLBACK_WINDOW` is the only definition of the rollback window. Other sections refer to it and do not restate it.

- **Length:** 14 days after the cutover flag is set (step 7.1).
- **Closes only when both hold:**
  1. at least 14 days have elapsed since the flag was set; and
  2. at least one full payout cycle and one verified restore from the daily export (issue 12a, read back through the
     restore path in issue 12b) have completed on Cloudflare, with no discrepancy in the post-cutover checks.
- **Otherwise it extends**, and the post-window reconciliation (step 10) does not start.
- **Issue 17 (retire the Node production entry) runs only after the window closes.**

Drift risk: the reverse export carries every write made after cutover, so the rollback delta grows with the window's
length. Deletes after cutover are not visible in an export without a tombstone (see R3). Both risks grow with the window,
which is why step 10 exists.

## 0. Preconditions

| Check | Why |
| --- | --- |
| Staging rehearsal (issue 15) passed with these same steps and checksums matched. | Proves the procedure before production. |
| Access service token, `OPS_SHARED_SECRET`, `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are set on the production Worker (issue 11a). `CF_ACCESS_TEAM_DOMAIN` is the team domain without a scheme. An assertion is accepted only when its `iss` is `https://<that domain>` (F12). | `/_ops` refuses everything otherwise. |
| Both production Durable Objects have run their own schema migrations (`apps/cloudflare/src/schema.ts`). Verify reports the SHORTLET version at top level and the PLATFORM version under `platform`; each must equal its own migration count. | Each import authority refuses with `SCHEMA_NOT_READY` when its schema is not current. |
| The production Worker has the `EXPORTS` R2 binding. It holds separate markers under `_ops/cutover/shortlet/` and `_ops/cutover/platform/`. Before cutover, status reports each marker absent and each completion time null. | Without the binding, imports fail closed; markers survive point-in-time restore of either object. |
| Neither object holds bearer credentials expected to move. Operator access tokens are issued only after both verifies pass. | All six credential/replay tables are excluded (ADRs 0093, 0086, 0075); verify reports counts under the owning authority and they must be zero on both targets. |
| **Checklist C1:** the value `MAX_STATEMENT_PARAMETERS = 100` in `packages/platform-core/src/data-migration.ts` is verified against the live Cloudflare Durable Object limits page before cutover. It came from a search summary, not the live page. Record the page's date and value in the log. | Chunk sizes and the object's own statement limit depend on it. |
| **Checklist C2:** the production Node file has no table outside the object's schema. `local_pilot_clock` is a local-development table and must be absent. The export is refused by the object if a table is missing (`UNKNOWN_TABLE`), so a mismatch stops the push rather than losing data. | Export scope is every application table (issue 16, Decisions: export scope). |
| `SHORTLET_PUBLIC_ORIGIN` is the final origin and the Paystack dashboard's callback and webhook URLs are known. | Needed for step 6. |
| A write-protected copy of the Node SQLite file, its `-wal` sidecar if present, and its receipts folder is kept. | This is the rollback source. |

Set the remote values in the shell session only. Never put them in a file, a URL or the log:

```bash
export SHORTLET_OPS_URL="https://<production-worker-origin>"
export SHORTLET_OPS_SECRET="<from the secret store>"
export CF_ACCESS_CLIENT_ID="<from the Access service token>"
export CF_ACCESS_CLIENT_SECRET="<from the Access service token>"
```

## 1. Freeze Node writes (D4)

The Node pilot has no clean in-process read-only mode. Writes also come from timers that run without a request: the
notification sweep (`setInterval` in `apps/pilot/src/pilot-server.ts`, every `DEFAULT_NOTIFICATION_SWEEP_SECONDS` = 30 s
by default, when notifications are configured). A request guard would miss those, so the freeze is a stopped process.
Whether a maintenance page also sits at the edge is for the user to choose (**Needs user**, see below). The verification
below applies either way.

1. Stop the Node pilot process. Guests should see the paused page from the edge, not a connection error.
2. Verify no writer is running. This must print nothing:
   ```bash
   pgrep -af "<Node pilot entry point>"
   ```
3. Verify the file is not changing. Record the checksums and sizes of the database and its `-wal` sidecar (if present),
   wait at least two sweep intervals (60 s by default), then repeat. The two readings must be identical:
   ```bash
   sha256sum "<SHORTLET_DB_PATH>" "<SHORTLET_DB_PATH>-wal" 2>/dev/null; stat -c '%s %y' "<SHORTLET_DB_PATH>" "<SHORTLET_DB_PATH>-wal" 2>/dev/null
   ```
   If the readings differ, the freeze has failed. Do not export.
4. Copy the database, its `-wal` sidecar and the receipts folder to the rollback location. Confirm the copy's checksum
   equals the reading in step 3. Do not write to the original file again.

## 2. Export

From the repository root, on a machine that can read the frozen SQLite file:

```bash
npx tsx scripts/export-node-sqlite.ts --export "<SHORTLET_DB_PATH>" "<EXPORT_DIR>"
```

This writes one `<table>.jsonl` per application table, a `receipts/` folder with one file per receipt (named by its opaque key),
and `manifest.json`. The manifest holds the row count and SHA-256 per table, and the receipt sizes and SHA-256. It
prints counts only. The source file is opened read-only. Control tables (`schema_migrations`, `migration_state`) are
never exported. The six bearer-credential/replay tables are not in the manifest either: `manifest.json` records only each one's source
row count under `excludedTables` (issue 16 B), and no file is written for them.

Record the manifest's SHA-256 (`sha256sum manifest.json`) in the log.

### 2.1 Prepare a pre-split export for the two-object schema

Keep `<EXPORT_DIR>` write-protected as immutable source evidence. Make `<MIGRATION_DIR>` as a separate derived copy and
record every row-count and checksum change in a transform ledger beside it. Never edit the original export.

- **Legacy account schema default:** if pre-split `guest_accounts` rows lack `email_revision`, add the target schema's
  declared default `0` to each derived row and recompute that table's canonical row count and SHA-256. This is a
  representation change for the new account schema only; it is not evidence for Identity Assurance.
- **Legacy Identity Assurance:** the pre-split `guest_identity_assurance` schema has no `account_email_revision`, so its
  rows cannot be bound to the platform account email revision. Omit those rows from the derived import, set the derived
  assurance table to the canonical empty-table checksum, and record the omitted row count. Do not add revision `0`, treat
  `verified` as current, or claim source/target checksum equality for those rows. Guests must complete fresh verification.
- **Credential/replay material:** retain source counts in the transform ledger and exclude all six current credential
  tables, including `guest_account_email_commands`. No credential table file is imported; guests and operators sign in again.
- Keep all other source files and counts unchanged. The transformed manifest is the comparison baseline; preserve the
  original manifest and ledger to account for the intentional differences.

This transform applies when the source schema lacks the revision columns. A new two-object daily export carries the current
assurance shape and restores those rows normally after its PLATFORM account parents.

## 3. Receipts to R2

Upload each file in `<EXPORT_DIR>/receipts/` to the private `RECEIPTS` bucket, `shortlet-pilot-production-receipts`
(`apps/cloudflare/cloudflare.config.ts`). Use the project's pinned `cf` CLI. Its `r2 objects put` help (checked for this
pass) documents `--file`, `--content-type`, `--bucket-name` and the global `--mode`. The key is the file name, and the
content type is in `manifest.json` under `receipts`:

```bash
npm exec cf -- r2 objects put "<receipt-key>" --bucket-name "shortlet-pilot-production-receipts" --mode production \
  --file "<EXPORT_DIR>/receipts/<receipt-key>" --content-type "<contentType from manifest.json>"
```

The CLI's authentication (which `--profile`, which token) is **Needs user**. Do not use a public bucket or a presigned URL (ADR 0090).

Check that the bucket holds exactly `manifest.receipts.length` objects with the expected sizes before continuing. List
them with `npm exec cf -- r2 objects list --bucket-name "shortlet-pilot-production-receipts" --mode production`, following
`--cursor` across pages. Confirm the `list` flags with `cf r2 objects list --help` before the first run (not checked in this pass).

## 4. Import

```bash
npx tsx scripts/export-node-sqlite.ts --push "<MIGRATION_DIR>"
```

For a legacy source, push the transformed `<MIGRATION_DIR>` from section 2.1, retaining `<EXPORT_DIR>` unchanged. The
gateway routes PLATFORM-owned tables to PLATFORM and shortlet transactions to SHORTLET. Load parents in PLATFORM first
(accounts before linked principals and claims), followed by remaining PLATFORM tables and then SHORTLET tables; use
`importOrder()` within each owner. Each request holds at most `floor(100 / column count)` rows of that
table (D2), and its body stays within the documented 5 MiB chunk bound (`MAX_IMPORT_REQUEST_BYTES`). Each request is one
transaction on the owning object. A request with a malformed row is refused whole and nothing from it is written, so the command
stops at the first refused request. The owning object refuses with `SCHEMA_NOT_READY` if its schema is not current, and with
`CUTOVER_COMPLETE` once step 7.1 has run. The gateway refuses a credential table by name with `EXCLUDED_TABLE` (400), citing ADRs 0093,
0086 and 0075, and it refuses every import with `CUTOVER_MARKER_UNAVAILABLE` (503) when the marker cannot be read, so nothing is written.
Before cutover, re-running the push is safe: rows are upserted on their primary key (D1), and nothing is duplicated. Each
object enforces its foreign keys, so a child row whose parent is not loaded yet is refused and nothing from that request is written.

## 5. Verify

```bash
npx tsx scripts/export-node-sqlite.ts --pull "<VERIFY_DIR>"
npx tsx scripts/export-node-sqlite.ts --compare "<MIGRATION_DIR>/manifest.json" "<VERIFY_DIR>/verify.json"
```

`GET /_ops/import/verify` is the combined verify. Its top-level `tables` and `excludedTables` belong to SHORTLET; nested
`platform.tables` and `platform.excludedTables` belong to PLATFORM. Reverse export through `GET /_ops/export?table=…` is
routed to the same owner. Compare every transformed manifest table with its owner's checksum, and compare all six credential
counts with zero on both targets. Record the assurance omission and account-default transform separately; do not report an
unqualified full-source match.

`--compare` checks the transformed manifest's single-object view; confirm both owner maps from the combined verify separately.
Each application table is compared by row count and checksum. Each credential table is
compared by count: the Node file's count (`excludedSourceRows`, recorded in the manifest and dropped by design) and the object's
count (`excludedTargetRows`), which must be zero. The compare must print `match`. A `mismatch` names the tables that differ,
credential tables included. Stop on a mismatch. Do not switch traffic. Keep `verify.json` with the log. The verify response
also carries `schemaVersion` and the nested PLATFORM status; record both migration counts and both pre-cutover marker/time
pairs (`absent`/null).

## 6. Paystack callback and webhook URLs

If the public origin changes, update the Paystack dashboard for the environment in use:

- Callback URL: `<SHORTLET_PUBLIC_ORIGIN>/payments/paystack/callback`
- Webhook URL: `<SHORTLET_PUBLIC_ORIGIN>/webhooks/paystack`

Record the old values so step R6 can restore them. Staging uses Paystack test keys. Production uses live keys, so
confirm which environment is being changed before saving.

## 7. Complete the cutover flag, then switch DNS

**7.1 Set the one-way cutover.** This is the point after which either object accepts no migration import (D1). Run it
only after steps 5 and 6 have passed:

```bash
npx tsx scripts/export-node-sqlite.ts --cutover-complete
```

The authenticated gateway completes both authorities independently. Each writes its marker first, then its SQL flag:
`_ops/cutover/shortlet/<SHORTLET object id>.json` and `_ops/cutover/platform/<PLATFORM object id>.json`. The response
contains `cutoverCompletedAt` and `platformCutoverCompletedAt`; preserve both timestamps. If either authority fails, do not
switch DNS. Failure is fail closed:

- A failed marker write returns `503 CUTOVER_MARKER_UNAVAILABLE` and records nothing. Fix the binding, then run the step again.
- A failure after the marker returns `503 CUTOVER_NOT_RECORDED`. Run the step again to finish the flag. Imports are refused
  in the meantime, because the marker is set.

Calling it again returns both first timestamps. Then `GET /_ops/status` must show both values and both markers as `present`.
No route or script in this repository clears either marker or flag. A point-in-time restore rewinds one object's storage,
including its flag, but not its kind-specific marker. Each object re-asserts its own flag from that marker when it starts and
before any import, so no manual flag step follows a restore. The restore runbook
(section 3) checks the status instead. Record the time in the log. `ROLLBACK_WINDOW` starts here.

**7.2 Switch DNS.** Point the public hostname at the Cloudflare Worker route. The route and the TTL are **Needs user**.
Lower the TTL in advance. Record the time of the switch.

## 8. Smoke tests

Run these after the switch, in order. Use the staging smoke tests from issue 15 where possible.

1. The public origin's guest home page loads over HTTPS with no mixed content.
2. A synthetic booking request can be created and reaches the operator inbox (synthetic data only, until ADR 0095's
   gates clear).
3. An operator sign-in works and the back office lists the imported units and bookings.
4. A receipt from the R2 bucket can be opened by a signed-in back-office user with the right grant (ADR 0090).
5. The Paystack webhook test event reaches `/webhooks/paystack` and is acknowledged.
6. `--pull` and `--compare` (step 5) still match, to show nothing changed during the smoke tests beyond expected
   new rows.

## 9. Rollback

Roll back if the verify step (step 5) fails, a smoke test fails, or any payment or receipt cannot be reconciled. The
user decides. The rollback is possible only while `ROLLBACK_WINDOW` is open. Anything written to the object after
the switch is first reverse-exported and then applied to the Node file, so no post-cutover write is lost.

R1. **Stop writes to the object.** Put the maintenance page in front of the Worker (mechanism **Needs user**). The
    object's data is then frozen for the rollback, as Node's was in step 1.

R2. **Reverse-export the object.** Run `--pull "<POST_DIR>"` (the same command as step 5, into a new folder). This gives
    the object's state after cutover.

R3. **Find the rows added, changed or deleted after cutover.** The export files are canonical sorted lines, so compare them
    per table with `comm`. Sort both sides the same way. Two comparisons are needed, because a deleted row is in the cutover
    export only:

    ```bash
    LC_ALL=C sort "<EXPORT_DIR>/<table>.jsonl" > "<TMP>/before.txt"
    LC_ALL=C sort "<POST_DIR>/<table>.jsonl" > "<TMP>/after.txt"
    LC_ALL=C comm -13 "<TMP>/before.txt" "<TMP>/after.txt" > "<DELTA_DIR>/<table>.jsonl"   # added or changed (new value)
    LC_ALL=C comm -23 "<TMP>/before.txt" "<TMP>/after.txt" > "<REMOVED_DIR>/<table>.jsonl" # deleted or changed (old value)
    ```

    Every table gets one delta file, empty if nothing changed, except the six bearer-credential/replay tables, which are not pulled (step 5). A non-empty `<REMOVED_DIR>` file is a row the object no
    longer has. **Known drift risk:** the import is upsert-only and has no delete path (D1), so R5 cannot remove a row from
    Node. Any non-empty removed set stops the rollback until a person has reviewed each row and recorded the decision in
    the log. The removed set is only as complete as the cutover export: keep `<EXPORT_DIR>` with the log. The risk grows with
    the window's length, because deletes accumulate.

R4. **Find the receipts written or removed after cutover.** Keys in `<POST_DIR>`'s manifest that are not in the cutover
    manifest are new. Keys in the cutover manifest that are not in `<POST_DIR>`'s manifest are removed, and the same stop rule
    as R3 applies. Download each new receipt from R2 by key into `<DELTA_DIR>/receipts/<key>`:

    ```bash
    npm exec cf -- r2 objects get "<key>" --bucket-name "shortlet-pilot-production-receipts" --mode production \
      > "<DELTA_DIR>/receipts/<key>"
    ```

    `cf r2 objects get --help` says the body is written as raw bytes unless `--text` is given, so `--text` must not be used
    for a receipt. The shell redirection is the output method. This resolves open decision 8 in issue 16 (the earlier documented gap). It is
    **verified only by the checksum gate**: each file's `sha256sum` must equal its manifest entry, and a mismatch stops the
    rollback. Confirm the method with a synthetic receipt on staging before production.
    Write `<DELTA_DIR>/manifest.json` with `formatVersion`, a `tables` entry for every table (its `rowCount` and `sha256` of
    the delta file), and a `receipts` entry for each new receipt (`objectKey`, `contentType`, `size`, `sha256`, with the
    SHA-256 from `sha256sum`). `movedTables` is `["receipt_blobs"]`.

R5. **Apply the delta to the frozen Node file.** Use the copy from step 1, not the original file's current state. The file
    must be migrated first (D3). The migration creates only the tables that are missing, and it is idempotent on a migrated file:

    ```bash
    npx tsx scripts/export-node-sqlite.ts --migrate "<RESTORED_DB_PATH>"
    npx tsx scripts/export-node-sqlite.ts --import "<RESTORED_DB_PATH>" "<DELTA_DIR>"
    ```

    The import upserts changed rows on their primary key and writes the receipts into the Node blob table. It checks
    each receipt against its SHA-256 first. It never deletes. The six bearer-credential/replay tables are skipped, so no session or
    sign-in challenge is written back to Node (F4): sessions are re-established in Node after a rollback.

R6. **Restore the Node pilot.** Start it against `<RESTORED_DB_PATH>`. Point DNS back at the Node origin. Restore the
    Paystack callback and webhook URLs recorded in step 6. Run the Node smoke tests.

R7. **Reconcile money.** For every Paystack transaction that arrived after the switch, check the Node record. The
    platform refunds any late payment in full (ADR 0045), and the owner payable and margin follow ADR 0089. Record
    each reconciliation in the log.

## 10. Post-window reconciliation

Run this only when `ROLLBACK_WINDOW` has closed. It finds drift the rollback comparison (R3 and R4) cannot see: deletes
made after cutover, and changes in the tables the daily export covers.

**What the daily export is (issue 12a, widened by issue 16, `apps/cloudflare/src/do-export.ts`).** Each authority's alarm writes its
owned files to the private `EXPORTS` bucket (`shortlet-pilot-production-exports`), at keys `YYYY-MM-DD/<table>.jsonl`. The
date is the Africa/Lagos day (ADR 0078). Each file holds one table's rows as read during that alarm, in pages: one line per row, in rowid order, in the table's
own column order, encoded as the import route reads it (a BLOB is `{"$bytes": ...}`). The tables are read one after another, so
the day's files are per-table snapshots, not one point-in-time snapshot across tables (F6). A table that does not exist in the object gets
an empty file. The union of both exports covers **every application table except the six bearer-credential/replay tables in `DAILY_EXPORT_EXCLUDED`**
(issue 16, delegated decision of 10 Oct 2026). It has no checksums, no manifest and no timestamp. It is written once per Lagos day,
at the first alarm of that day, so rows written after that alarm are not in it. The bucket keeps 400 days by default
(`SHORTLET_EXPORT_RETENTION_DAYS`) (`SHORTLET_EXPORT_RETENTION_DAYS`).

1. **Choose the export day.** List the `EXPORTS` bucket and take the newest `YYYY-MM-DD/` prefix. Follow `--cursor`
   across pages. Download that day's file for every table in `EXPORT_TABLES` into `<RECON_DIR>/export/`:

   ```bash
   npm exec cf -- r2 objects list --bucket-name "shortlet-pilot-production-exports" --mode production
   npm exec cf -- r2 objects get "YYYY-MM-DD/<table>.jsonl" --bucket-name "shortlet-pilot-production-exports" --mode production \
     > "<RECON_DIR>/export/<table>.jsonl"
   ```

   The shell redirection is the output method, as in R4. The export has no manifest to check the bytes against, so the
   method is confirmed on a synthetic export file on staging before production (checklist C7).

2. **Pull the object.** Run `--pull "<POST_DIR>"` (the command in step 5). Its `<table>.jsonl` files are canonical: keys
   sorted, lines sorted, BLOBs as `{"$bytes": ...}`. They cover all application tables. Use only the files for the tables in `EXPORT_TABLES`.

3. **Bring both sides to one form.** For each exported table, sort the keys of every line and then sort the lines
   (`jq` is assumed; confirm it exists before the first run):

   ```bash
   jq -S -c . "<RECON_DIR>/export/<table>.jsonl" | LC_ALL=C sort > "<RECON_DIR>/before/<table>.txt"
   jq -S -c . "<POST_DIR>/<table>.jsonl" | LC_ALL=C sort > "<RECON_DIR>/after/<table>.txt"
   ```

   `manual_transfer_receipts` is exported with five columns only (`receipt_id, transfer_id, content_type, object_key,
   size_bytes`; see `PROJECTIONS` in `do-export.ts`). Project the pulled file to those five keys before comparing:
   `jq -S -c '{receipt_id, transfer_id, content_type, object_key, size_bytes}'`.

4. **Compare in both directions.** Use the table's primary key, as the import uses it (`tableShape` in
   `apps/cloudflare/src/ops-import.ts`), to classify each differing line:

   ```bash
   LC_ALL=C comm -23 "<RECON_DIR>/before/<table>.txt" "<RECON_DIR>/after/<table>.txt"   # in the export, not now
   LC_ALL=C comm -13 "<RECON_DIR>/before/<table>.txt" "<RECON_DIR>/after/<table>.txt"   # now, not in the export
   ```

   - An export line whose key is absent from the object is a **deleted row**. It is a discrepancy.
   - An export line whose key is present with different content is a **changed row**. It is a discrepancy, unless the
     table's own timestamp column shows the change happened after the export day.
   - A pulled line whose key is not in the export is a **post-export write**. It is expected. Record its count, and treat
     it as a discrepancy only if its timestamp falls before the export day.

5. **Compare receipts both ways.** Take the `object_key` values from the export's `manual_transfer_receipts` file and
   from the pulled file, sort them, and compare them with `comm -3`. A key only in the export is a receipt the object no
   longer references (ADR 0090). It is a discrepancy. A key only in the pull is a receipt uploaded after the export day.

6. **Record.** Log every discrepancy and every count. Any discrepancy means the window did not close:
   `ROLLBACK_WINDOW` extends, and this step runs again after the next full payout cycle.

7. **Coverage (decided, issue 16 and Needs user item 6).** This step reconciles every table in `EXPORT_TABLES`. The six tables
   it does not cover are the bearer-credential tables in `DAILY_EXPORT_EXCLUDED` (`apps/cloudflare/src/do-export.ts`):
    `guest_account_sessions`, `guest_session_bindings`, `guest_sign_in_codes`, `guest_account_email_commands`,
    `operator_access_tokens` and `operator_sessions`.
   They hold no evidence, and a session or challenge is not reconciled after the window. The restore runbook
   (`docs/runbooks/cloudflare-restore.md`, section 2) says what a rebuild cannot restore. The closing record for the window states
    that these six were not compared.

## Checklist before cutover

- [ ] C1: `MAX_STATEMENT_PARAMETERS` checked against the live Cloudflare Durable Object limits page. Date and value recorded.
- [ ] C2: the production Node file has no table outside the object's schema (no `local_pilot_clock`).
- [ ] C3: the object's `schemaVersion` equals the migration count in `apps/cloudflare/src/schema.ts`.
- [ ] C4: the receipt download method (R4) confirmed with a synthetic receipt on staging.
- [ ] C5: the `cf r2 objects list` flags confirmed with `--help`.
- [ ] C6: the data-protection gates (ADR 0095) cleared. **Needs user.**
- [ ] C7: the `EXPORTS` daily-export download method (step 10.1) confirmed with a synthetic export file on staging.
- [ ] C8: `GET /_ops/status` before cutover reports top-level SHORTLET and nested PLATFORM markers `absent` and completion timestamps `null`; confirm the `EXPORTS` binding (issue 16 A).
- [ ] C9: the compare at step 5 printed `match`, with `excludedTargetRows=0` (issue 16 B).
- [ ] C11: `npm ci`, then `npm run worker:build:production` and `npm run worker:deploy:dry-run:production` pass on a clean checkout of the
  release commit, with no account login and no upload (issue 16 C; `docs/pilot-deployment.md`).
- [ ] C10: guests and operators are told before step 7.2 that they **sign in again** after the cutover, because their sessions and sign-in codes are not moved (issue 16 B; ADRs 0093, 0086, 0075). The wording and the channel are **Needs user**.

## Needs user

These need human facts or decisions. None is decided in this runbook.

1. The production account, the `cf` authentication profile, and the Access service token (no values in this repository).
2. The data-protection gates in ADR 0095 (counsel, transfer basis, vendor terms, DPIA). These block any run on real data.
3. The freeze mechanism at the edge: a maintenance page or a Worker response, and its wording. The process stop in step 1 applies either way.
4. The Worker route, the DNS record and the TTL (step 7.2).
5. The go or no-go for cutover, and the sign-off of this runbook (issue 16 AC4).
6. Daily export coverage: **decided** (issue 16, delegated 10 Oct 2026). Every application table except the six bearer-credential/replay
   tables is in the daily export (step 10.7). The six exclusions and their reasons are for review at the sign-off in item 5.
7. The cutover and sign-in communication (checklist C10): the wording and the channel for telling guests and operators that they sign
   in again. **Decided:** the sign-in is required, because sessions and codes are not moved (issue 16 B).
8. Rebuilds after a cutover (restore runbook, section 2): a rebuild from export cannot load into a tenant whose cutover marker is set,
   because imports are refused by design (issue 16 A). **Decided (10 Oct 2026):** no route clears the marker. The only rebuild path into
   such a tenant is the break-glass in restore runbook section 2 (B0 to B7): a person with R2 write access runs
   `cf r2 objects delete` on the marker key, before any request reaches the object, then rebuilds and re-closes with
   `POST /_ops/cutover/complete`, logging each step. The delete holds only if the object's storage no longer carries the flag; B3
   checks it and stops the rebuild when the flag survived. If B3 stops, the recovery (a new tenant, or another design) is **Needs user**.

## 11. Cutover log

| Step | Started (WAT) | Finished (WAT) | Result | Operator |
| --- | --- | --- | --- | --- |
| 0 Preconditions (C1 to C3 recorded) | | | | |
| 1 Freeze Node writes (checksums before and after the wait) | | | | |
| 2 Export (manifest SHA-256: ) | | | | |
| 3 Receipts to R2 (count: ) | | | | |
| 4 Import (`--push`) | | | | |
| 5 Verify (`--compare` result: , `schemaVersion`: ) | | | | |
| 6 Paystack URLs (old/new recorded) | | | | |
| 7.1 Cutover marker and flag (timestamp: , `cutoverMarker`: ) | | | | |
| 7.2 DNS switch | | | | |
| 8 Smoke tests | | | | |
| Break-glass marker delete (only if used: date, reason, operator, original `completedAt`, B3 result, B5 timestamp) | | | | |
| `ROLLBACK_WINDOW` open / close (date: ) | | | | |
