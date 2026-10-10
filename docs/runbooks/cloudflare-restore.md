# Restore the Cloudflare pilot (Durable Object)

The production pilot's system of record is one SQLite-backed Durable Object per tenant. This runbook covers
recovering it after corruption, a bad import, or a botched migration. **Any restore loses writes made after the
restore point**, so the money and receipt checks at the end are mandatory, not optional (ADRs 0045/0089).

Everything here runs against the tenant's object; the tenant is `SHORTLET_TENANT_ID` and the Worker routes to
`idFromName(tenantId)`.

## 1. Point-in-time recovery (PITR)

Durable Object storage keeps a **30-day** point-in-time recovery window. A restore is bookmarked, not immediate:
you schedule a bookmark and the object applies it on its **next session** (restart or eviction).

Choose the restore time as the last moment you believe the data was correct — for example just before a bad import
or a faulty deploy (take it from the deploy/build log or the incident timeline). Then:

1. **Dry run — get the bookmark.** Call the authenticated route with no `confirm`:

   ```bash
   curl -sS -X POST "$SHORTLET_OPS_URL/_ops/restore" \
     -H "X-Shortlet-Ops-Secret: $SHORTLET_OPS_SECRET" \
     -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
     -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"timeMs": 1760000000000}'
   ```

   The response is `{ "ok": true, "bookmark": "<bookmark>", "restartRequired": false }`. Omit `timeMs` to bookmark
   "now" (useful before a risky operation).

2. **Confirm — schedule the restore.** Send the bookmark back with `confirm: true`:

   ```bash
   curl -sS -X POST "$SHORTLET_OPS_URL/_ops/restore" \
     -H "X-Shortlet-Ops-Secret: $SHORTLET_OPS_SECRET" \
     -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
     -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"confirm": true, "bookmark": "<bookmark>"}'
   ```

   A confirm without a bookmark is refused (`400`). Both steps need **both** authentication layers; without them the
   request is a bare `401`.

3. **Restart the object.** The bookmark applies on the next session. Redeploy the Worker, or evict the object (a
   new version/instance is created on the next request). Until it restarts, the object still serves the old data.

**Why a route, not a one-off script.** The bookmark APIs (`getBookmarkForTime` / `onNextSessionRestoreBookmark`)
live on the Durable Object's `ctx.storage`, not in a file, so a script would have to reach into the object anyway.
The route reuses 11a's two authentication layers and adds an explicit two-step confirm, and it is covered by
workerd tests. A one-off script would need its own auth and its own tests for the same effect.

## 2. Rebuild from the daily exports (when PITR is not enough)

**What an export day is.** Once per Africa/Lagos day (ADR 0078), at the first alarm of that day, the object writes one
object per exported table to the private `EXPORTS` bucket, at `YYYY-MM-DD/<table>.jsonl`. The exported tables are every
name in `EXPORT_TABLES` (`apps/cloudflare/src/do-export.ts`). Each object holds one table's rows as read during that alarm, in
pages: one JSON line per row, in rowid order, in the transport encoding the import route reads (a BLOB is
`{"$bytes": "<base64>"}`). The tables are read one after another, across awaits, so a day's objects are **per-table snapshots,
not one point-in-time snapshot across tables**: a write made during the alarm can appear in one table's file and not in a
related table's file. The load's foreign-key checks and the count check in step 4 catch the gaps this can leave (section 3). Objects are kept for `SHORTLET_EXPORT_RETENTION_DAYS` (default 400). The five tables in
`DAILY_EXPORT_EXCLUDED` are not exported (see "What the rebuild does not restore"). Read a day's objects with the pinned
`cf` CLI or the R2 dashboard. They are private and never public.

**Load one day, not every day.** Each day is a set of per-table snapshots, not a change set, so a rebuild loads a single day: the newest day
whose set is complete. Loading every day oldest first is wrong. The import upserts by primary key and never deletes, so a
row deleted after the older day would survive the rebuild, and the object would hold rows the source no longer has.
`apps/cloudflare/test/restore-from-export.spec.ts` demonstrates this.

**Procedure.**

1. **Choose the day.** Take the newest `YYYY-MM-DD/` prefix that has an object for every name in `EXPORT_TABLES`. Writes
   made after that day's alarm are not in it.
2. **Create the object.** A request to the origin creates the tenant's object, and the object applies its own schema
   migrations on start. Check `GET /_ops/status`: `schemaVersion` must equal the migration count in
   `apps/cloudflare/src/schema.ts`, and `cutoverMarker` must be `absent`. A `present` marker means this tenant's cutover is recorded
   in R2 (issue 16 A), so every import is refused with `CUTOVER_COMPLETE`, and a rebuild into that tenant is not possible under the
   current design (issue 16, Needs user item 8). An `unavailable` marker refuses every import (`CUTOVER_MARKER_UNAVAILABLE`).
3. **Load each table, parents first.** Load each table's file for the chosen day in the order `importOrder()`
   (`packages/platform-core/src/data-migration.ts`) returns for `EXPORT_TABLES`. That order follows the schema's foreign
   keys. The object enforces foreign keys, so a child row whose parent is not loaded yet is refused: `POST /_ops/import`
   answers `422 BATCH_REJECTED`, nothing from that request is written, and the load must stop there and be fixed. Split
   each file into requests of `floor(100 / column count)` rows, with each body at most 5 MiB, as `importRequestChunks`
   does. POST each request to `/_ops/import` as `{ "table": "<table>", "rows": [ ... ] }`. No packaged command loads a day
   export (`--push` reads the cutover manifest, which a day export does not have). The restore test is the reference loop.
4. **Verify the counts.** For every name in `EXPORT_TABLES`, `tables[<table>].rowCount` from `GET /_ops/import/verify`
   must equal the number of lines in that day's file. The five excluded tables must read `0`.
5. **Confirm the cutover state.** The one-way flag lives in a control table, which is not exported. The cutover marker lives in the
   `EXPORTS` bucket, outside the object's storage, so it is not part of the rebuild either. A rebuilt object re-asserts its flag from
   the marker when it starts and before any import (issue 16 A). Check `GET /_ops/status` after step 4: `cutoverMarker` and
   `cutoverCompletedAt` must agree with the tenant's history. No step in this runbook sets the flag or the marker.

**Row ordering.** The load does two things. Parents before children is required by the foreign keys (step 3). Within a
table, the import keeps the file's order: it sends rows in file order and inserts them in that order, and an upsert of
an existing row keeps that row's rowid. Reads that use `ORDER BY rowid` (for example `units`, `operators`, the revenue
journals and the enforcement records) therefore keep their relative order. Absolute rowid values are not preserved.
Rows created and then deleted within one day are in no export.

**What the rebuild does not restore.**

- Writes after the day's first alarm. Money and receipts in that gap are reconciled as described in section 3.
- Sessions and credentials. `guest_account_sessions`, `guest_session_bindings`, `operator_sessions`,
  `operator_access_tokens` and `guest_sign_in_codes` are not exported (`DAILY_EXPORT_EXCLUDED`, ADRs 0075, 0086, 0093).
  A rebuild cannot revive a session or an open sign-in challenge, so every guest and operator signs in again. A session
  revoked before the rebuild stays revoked. The same five tables are refused by `GET /_ops/export` and are not pulled or
  rolled back into Node, so sessions are re-established after a rollback as well (cutover runbook, step R5).
- Receipt bytes. The `RECEIPTS` bucket is separate and is not rebuilt from the export. The metadata rows are restored,
  so check each receipt object exists (section 3).
- The cutover flag and the cutover marker. The flag is rebuilt from the marker on start. The marker is not in any export and is
  not restored by a rebuild; it survives both a point-in-time restore and a rebuild because it is kept outside the object.

## 3. After any restore — mandatory checks

- **Health.** `GET /healthz` returns `{ "ok": true }`.
- **Row counts.** Compare each exported table's count against the last export before the restore point.
- **Money after the restore point (ADRs 0045/0089).** The restore **loses every write after the bookmark**: card
  payments, bank transfers, refunds and payouts recorded since then exist at Paystack but not in the object.
  Reconcile them from the Paystack dashboard/API before returning to service, and re-record anything that must
  exist. Never assume the ledger is complete after a restore.
- **Receipts (R2 is not rolled back).** `RECEIPTS` is a separate R2 bucket and is **not** covered by the object's
  PITR. A receipt object may exist with no metadata row after a restore. The daily orphan sweep (12a) deletes
  objects older than the grace period with no row, so a receipt uploaded after the restore point can be swept —
  recover it from Paystack/bank evidence before it ages out, or re-upload it.
- **Cutover state (verify with status).** A point-in-time restore rewinds the object's storage, including the one-way cutover flag,
  but not the cutover marker in the `EXPORTS` bucket (issue 16 A). The object re-asserts the flag from the marker when it starts and
  before any import, so a restore to a point before the cutover still refuses imports once the marker is read. No manual flag step
  is needed. Verify it with `GET /_ops/status` (both authentication layers), before any import or any return to service:

  ```bash
  curl -sS "$SHORTLET_OPS_URL/_ops/status" \
    -H "X-Shortlet-Ops-Secret: $SHORTLET_OPS_SECRET" \
    -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
    -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET"
  ```

  - `schemaVersion` must equal `expectedSchemaVersion`.
  - If the cutover had completed before the restore point, `cutoverCompletedAt` must not be `null` and `cutoverMarker` must be
    `present`. Record both timestamps in the log. A `cutoverCompletedAt` that is `null` with `cutoverMarker: "present"` is not a
    valid state: stop and report it, because the object should have re-asserted the flag.
  - `cutoverMarker: "unavailable"` means the marker could not be read, so every import is refused. Restore the `EXPORTS` binding
    and check again. Do not treat `unavailable` as "not cut over".
  - A restore that was meant to go back before the cutover, so that the object should accept imports again, is a decision for a
    person (issue 16, Needs user item 8). It is not available through this runbook.
  - A rebuild from exports (section 2, step 5) has the same check.
- **Post-restore consistency.** Before returning to service, record each of these in the log:
  1. The load of the chosen day finished with every request accepted. A `BATCH_REJECTED` (422) during the load means a child row
     was loaded before its parent, or a foreign key failed. Stop, fix the load, and start again from an empty object.
  2. `GET /_ops/import/verify` `tables[<table>].rowCount` equals the line count of that day's file for every table in
     `EXPORT_TABLES` (section 2, step 4). The five excluded tables read `0`.
  3. Because the day's files are per-table snapshots, rows written after the alarm are absent, and related rows can be
     out of step across tables. Record the day, the alarm time (from the export) and the writes the business knows of after it.
     Do not treat a matching count as proof that the tables agree with each other.
- **Operator sessions (PITR only).** A point-in-time restore brings back sessions as they were at the bookmark, so
  sessions that were revoked after it are valid again. Revoke any that were meant to be closed after the restore point
  (`DELETE /_ops/operators/:id/access`). A rebuild from exports does not restore sessions at all (section 2).

## 4. Rehearsal

The rehearsal (forcing the object to restart mid-restore, then walking these checks) is recorded in **slice 15**
along with the staging evidence.
