# Cut over the pilot from Node to Cloudflare (DRAFT)

> **DRAFT. Not approved for use.** This runbook was drafted by the agent for issue 16 and needs the user's review
> before anyone runs any step against production (issue 16 AC4). Open decisions are listed at the end. Do not run
> it with real guest or payment data until the data-protection gates in ADR 0095 are cleared (counsel approval of the
> cross-border transfer basis, vendor terms and the DPIA). Staging rehearsal (issue 15) comes first.

The Node pilot keeps one SQLite file (`SHORTLET_DB_PATH`) and its receipts. The Cloudflare pilot keeps all state in
one SQLite-backed Durable Object per tenant, with receipts in the private `RECEIPTS` R2 bucket (ADRs 0004, 0090, 0095).
This runbook moves the data, switches traffic, and defines how to go back.

Record every step with its start time, end time, result and operator in the log at the end. Do not write secrets,
tokens or guest data in the log. Counts and checksums are enough.

## 0. Preconditions

| Check | Why |
| --- | --- |
| Staging rehearsal (issue 15) passed with these same steps and checksums matched. | Proves the procedure before production. |
| Access service token, `OPS_SHARED_SECRET`, `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are set on the production Worker (issue 11a). | `/_ops` refuses everything otherwise. |
| The production Durable Object has the target schema, with every table the Node export contains. | Import refuses an unknown table. See open decision 1. |
| `SHORTLET_PUBLIC_ORIGIN` is the final origin and the Paystack dashboard's callback and webhook URLs are known. | Needed for step 6. |
| A write-protected copy of the Node SQLite file and its receipts folder is kept. | This is the rollback source. |

Set the remote values in the shell session only. Never put them in a file, a URL or the log:

```bash
export SHORTLET_OPS_URL="https://<production-worker-origin>"
export SHORTLET_OPS_SECRET="<from the secret store>"
export CF_ACCESS_CLIENT_ID="<from the Access service token>"
export CF_ACCESS_CLIENT_SECRET="<from the Access service token>"
```

## 1. Freeze Node writes

1. Put the Node pilot behind a maintenance page, or stop the process, so no request can write. The mechanism is for
   the user to choose. Guests must see a clear "service paused" page, not an error.
2. Confirm the freeze. Take a copy of the SQLite file (`SHORTLET_DB_PATH`) and a copy of the receipts. Record the file
   size and modification time. Those copies are the rollback source. Do not write to the original file again.

## 2. Export

From the repository root, on a machine that can read the frozen SQLite file:

```bash
npx tsx scripts/export-node-sqlite.ts --export "<SHORTLET_DB_PATH>" "<EXPORT_DIR>"
```

This writes one `<table>.jsonl` per table, a `receipts/` folder with one file per receipt (named by its opaque key),
and `manifest.json`. The manifest holds the row count and SHA-256 per table, and the receipt sizes and SHA-256. It
prints counts only. The source file is opened read-only.

Record the manifest's SHA-256 (`sha256sum manifest.json`) in the log.

## 3. Receipts to R2

Upload each file in `<EXPORT_DIR>/receipts/` to the private `RECEIPTS` bucket. The key is the file name, and the content
type is in `manifest.json` under `receipts`. The upload method (for example `wrangler r2 object put` with `--remote`)
is for the user to confirm. Do not use a public bucket or a presigned URL (ADR 0090).

Check that the bucket holds exactly `manifest.receipts.length` objects with the expected sizes before continuing.

## 4. Import

```bash
npx tsx scripts/export-node-sqlite.ts --push "<EXPORT_DIR>"
```

This sends each table's rows to `POST /_ops/import` in batches of 100 rows. Each batch is one transaction on the object.
A batch with a malformed row is refused whole and nothing from it is written, so the command stops at the first refused
batch. Re-running the push is safe: rows are upserted on their primary key and nothing is duplicated.

## 5. Verify

```bash
npx tsx scripts/export-node-sqlite.ts --pull "<VERIFY_DIR>"
npx tsx scripts/export-node-sqlite.ts --compare "<EXPORT_DIR>/manifest.json" "<VERIFY_DIR>/verify.json"
```

`--pull` reads each table back from the object (read-only) and writes `verify.json` and the table files there.
`--compare` must print `match`. A `mismatch` names the tables that differ. Stop on a mismatch. Do not switch traffic.
Keep `verify.json` with the log.

## 6. Paystack callback and webhook URLs

If the public origin changes, update the Paystack dashboard for the environment in use:

- Callback URL: `<SHORTLET_PUBLIC_ORIGIN>/payments/paystack/callback`
- Webhook URL: `<SHORTLET_PUBLIC_ORIGIN>/webhooks/paystack`

Record the old values so step R6 can restore them. Staging uses Paystack test keys. Production uses live keys, so
confirm which environment is being changed before saving.

## 7. Switch DNS

Point the public hostname at the Cloudflare Worker route (the user chooses the route and the TTL). Lower the TTL in
advance. Record the time of the switch.

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
user decides. Rollback is defined as follows. Anything written to the object after the switch is first reverse-exported
and then applied to the Node file, so no post-cutover write is lost.

R1. **Stop writes to the object.** Put the maintenance page in front of the Worker, as in step 1.

R2. **Reverse-export the object.** Run `--pull "<POST_DIR>"` (the same command as step 5, into a new folder). This gives
    the object's state after cutover.

R3. **Find the rows written or changed after cutover.** The export files are canonical sorted lines, so compare them
    per table with `comm`. Sort both sides the same way:

    ```bash
    LC_ALL=C sort "<EXPORT_DIR>/<table>.jsonl" > "<TMP>/before.txt"
    LC_ALL=C sort "<POST_DIR>/<table>.jsonl" > "<TMP>/after.txt"
    LC_ALL=C comm -13 "<TMP>/before.txt" "<TMP>/after.txt" > "<DELTA_DIR>/<table>.jsonl"
    ```

    Every table gets one delta file, empty if nothing changed.

R4. **Find the receipts written after cutover.** These are keys in `<POST_DIR>`'s manifest that are not in the cutover
    manifest. Download each one from R2 by key into `<DELTA_DIR>/receipts/<key>`. Write `<DELTA_DIR>/manifest.json`
    with `formatVersion`, a `tables` entry for every table (its `rowCount` and `sha256` of the delta file), and a
    `receipts` entry for each new receipt (`objectKey`, `contentType`, `size`, `sha256`, with the SHA-256 from
    `sha256sum`). `movedTables` is `["receipt_blobs"]`.

R5. **Apply the delta to the frozen Node file.** Use the copy from step 1, not the original file's current state:

    ```bash
    npx tsx scripts/export-node-sqlite.ts --import "<RESTORED_DB_PATH>" "<DELTA_DIR>"
    ```

    The import upserts changed rows on their primary key and writes the receipts into the Node blob table. It checks
    each receipt against its SHA-256 first.

R6. **Restore the Node pilot.** Start it against `<RESTORED_DB_PATH>`. Point DNS back at the Node origin. Restore the
    Paystack callback and webhook URLs recorded in step 6. Run the Node smoke tests.

R7. **Reconcile money.** For every Paystack transaction that arrived after the switch, check the Node record. The
    platform refunds any late payment in full (ADR 0045), and the owner payable and margin follow ADR 0089. Record
    each reconciliation in the log.

**Limits of this rollback.** The comparison in R3 finds added and changed rows only. A row deleted from the object after
cutover is not found, because the export holds no tombstones. Check the object's deletes (retention sweeps in 12a and
any back-office deletes) before R5, and use the object's point-in-time recovery (issue 12b, 30 days) or the daily
export in the `EXPORTS` bucket (issue 12a) if the object cannot be read at all. The R2 orphan sweep (12a) can remove a
receipt object that has no row, so check the receipts before deleting anything.

## 10. Cutover log

| Step | Started (WAT) | Finished (WAT) | Result | Operator |
| --- | --- | --- | --- | --- |
| 0 Preconditions | | | | |
| 1 Freeze Node writes | | | | |
| 2 Export (manifest SHA-256: ) | | | | |
| 3 Receipts to R2 (count: ) | | | | |
| 4 Import (`--push`) | | | | |
| 5 Verify (`--compare` result: ) | | | | |
| 6 Paystack URLs (old/new recorded) | | | | |
| 7 DNS switch | | | | |
| 8 Smoke tests | | | | |

## Open decisions for the user

1. **Target schema.** `--push` refuses a table the object does not have, and the object creates its tables only as its
   stores are constructed. Decide how the production object gets every table before the import. The cleanest option
   is to construct every store on the ops path. Not built in issue 16.
2. **Export scope.** `EXPORT_TABLES` (issue 12a) lists the evidence tables only. The cutover export covers every
   application table in the Node file, so that no guest, operator or session state is left behind. Confirm this.
3. **Batch size bound.** The import route reuses the 11b 5 MiB bound for one batch request. Confirm that bound, or set
   another.
4. **Upsert on re-import.** A re-import replaces the stored values of a row with the file's values. Confirm this is the
   intended behaviour (the alternative is to keep the existing row and ignore the new one).
5. **Freeze mechanism and DNS route.** The maintenance page, the Worker route and the TTL are for the user to choose.
6. **Receipt upload method.** Confirm the R2 upload command and its authentication.
7. **Data-protection gates.** This runbook must not run on real data until ADR 0095's gates are cleared.
