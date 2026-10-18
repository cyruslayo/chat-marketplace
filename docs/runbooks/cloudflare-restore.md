# Restore the Cloudflare pilot (Durable Object)

The production pilot's system of record is three SQLite-backed Durable Objects per tenant: PLATFORM owns accounts and
conversations, SHORTLET owns shortlet transactions, and COMMERCE owns marketplace transactions (ADR 0101). This runbook covers
recovering it after corruption, a bad import, or a botched migration. **Any restore loses writes made after the
restore point**, so the money and receipt checks at the end are mandatory, not optional (ADRs 0045/0089).

The tenant is `SHORTLET_TENANT_ID`. The Worker routes to `PLATFORM.idFromName(tenantId)`,
`SHORTLET.idFromName(tenantId)` and `COMMERCE.idFromName(tenantId)`. The authenticated OPS gateway routes each imported or exported table to its owner.

## 1. Point-in-time recovery (PITR)

Durable Object storage keeps a **30-day** point-in-time recovery window. A restore is bookmarked, not immediate:
you schedule a bookmark and the object applies it on its **next session** (restart or eviction).

Choose the restore time as the last moment you believe the data was correct — for example just before a bad import
or a faulty deploy (take it from the deploy/build log or the incident timeline). PITR is object-scoped: schedule the
bookmark independently for all three tenant objects, using each object's ID and preserving the three bookmarks together
in the incident record. The authenticated `/_ops/restore` endpoint shown below is served by SHORTLET only. Use the
Cloudflare Durable Object recovery control for PLATFORM and COMMERCE. Do not return traffic until all three restores have
applied and all three status records have been checked.
For SHORTLET, then:

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

3. **Restart SHORTLET.** The bookmark applies on the next session. Redeploy the Worker, or evict the object (a
   new version/instance is created on the next request). Until it restarts, the object still serves the old data.

**Why a route, not a one-off script.** The SHORTLET bookmark APIs (`getBookmarkForTime` / `onNextSessionRestoreBookmark`)
live on that Durable Object's `ctx.storage`, not in a file, so a script would have to reach into the object anyway.
The route reuses 11a's two authentication layers and adds an explicit two-step confirm, and it is covered by
workerd tests. A one-off script would need its own auth and its own tests for the same effect.

## 2. Rebuild from the daily exports (when PITR is not enough)

**What an export day is.** Once per Africa/Lagos day (ADR 0078), at the first alarm of that day, each object writes one
object per owned exported table to the private `EXPORTS` bucket, at `YYYY-MM-DD/<table>.jsonl`. The union of exported tables is every
name in `EXPORT_TABLES` (`apps/cloudflare/src/do-export.ts`). Each object holds one table's rows as read during that alarm, in
pages: one JSON line per row, in rowid order, in the transport encoding the import route reads (a BLOB is
`{"$bytes": "<base64>"}`). The tables are read one after another, across awaits, so a day's objects are **per-table snapshots,
not one point-in-time snapshot across tables**: a write made during the alarm can appear in one table's file and not in a
related table's file. The load's foreign-key checks and the count check in step 4 catch the gaps this can leave (section 3). Objects are kept for `SHORTLET_EXPORT_RETENTION_DAYS` (default 400). The six
`DAILY_EXPORT_EXCLUDED` credential/replay tables are not exported (see "What the rebuild does not restore"). Read a day's objects with the pinned
`cf` CLI or the R2 dashboard. They are private and never public.

**Load one day, not every day.** Each day is a set of per-table snapshots, not a change set, so a rebuild loads a single day: the newest day
whose set is complete. Loading every day oldest first is wrong. The import upserts by primary key and never deletes, so a
row deleted after the older day would survive the rebuild, and the object would hold rows the source no longer has.
`apps/cloudflare/test/restore-from-export.spec.ts` demonstrates this.

**Procedure.**

**Legacy pre-split export transform (only when the source schema lacks revision columns).** Preserve the original export
directory and manifest write-protected as source evidence. Prepare a separate transformed copy and a transform ledger that
records source/derived row counts and canonical SHA-256 values for every changed table. For `guest_accounts` rows without
`email_revision`, add only the target schema's declared default `0` and recompute that table's checksum; this schema default
does not establish assurance validity. The old `guest_identity_assurance` rows lack `account_email_revision`, so do not
import them or synthesize revision `0`. Record the omitted row count and the derived empty-table checksum; affected Guests
must complete fresh identity verification (ADR 0094). Do not claim source-to-target checksum equality for intentionally
omitted assurance rows. Leave all other data unchanged. Exclude credential/replay tables, including
`guest_account_email_commands`; guests and operators authenticate again (ADRs 0075, 0086, 0093). The original manifest and
transform ledger account for these intentional differences.

1. **Choose the day.** Take the newest `YYYY-MM-DD/` prefix that has an object for every name in `EXPORT_TABLES` across
    all three owners. Writes
   made after that day's alarm are not in it.
2. **Create all three objects.** Before any request reaches an object, check all kind-scoped markers (break-glass B0 below). A marker that exists
   is re-asserted into its owner's flag when that object starts, and the object starts on its first request, so a marker found
    here changes what this step may do. If no marker exists, requests to the origin create all tenant objects, each applying
    its own schema migrations on start. Then check `GET /_ops/status`: top-level `schemaVersion`, nested
    `platform.schemaVersion` and `commerce.schemaVersion` must equal the corresponding migration counts; all `cutoverMarker` values must be `absent` and
    all `cutoverCompletedAt` values `null`. A `present` marker
   means this tenant's cutover is recorded in R2 (issue 16 A), so every import is refused with `CUTOVER_COMPLETE`; the only
   rebuild path is the break-glass below. An `unavailable` marker refuses every import (`CUTOVER_MARKER_UNAVAILABLE`); fix the
   marker's access first, and never use the break-glass to get past it.
3. **Load each table, parents first.** Load PLATFORM parent rows first (accounts before linked principals and claims), then
    the remaining PLATFORM tables, then SHORTLET-owned rows, then COMMERCE-owned rows. Use `importOrder()` (`packages/platform-core/src/data-migration.ts`)
   within each owner; the gateway routes each `POST /_ops/import` table to its owner. Each object enforces its foreign
   keys, so a child row whose parent is not loaded yet is refused:
   answers `422 BATCH_REJECTED`, nothing from that request is written, and the load must stop there and be fixed. Split
   each file into requests of `floor(100 / column count)` rows, with each body at most 5 MiB, as `importRequestChunks`
   does. POST each request to `/_ops/import` as `{ "table": "<table>", "rows": [ ... ] }`. No packaged command loads a day
   export (`--push` reads the cutover manifest, which a day export does not have). The restore test is the reference loop.
4. **Verify all authorities.** `GET /_ops/import/verify` returns the SHORTLET map at top level and PLATFORM and COMMERCE maps nested
    under `platform` and `commerce`. Compare each table's row count/checksum to its owner export and the transformed manifest. All excluded
   credential/replay counts must be zero. For a legacy transform, reconcile the account default and assurance omission in
   the ledger, and do not report equality for the intentionally omitted assurance rows.
5. **Confirm all cutover states.** Each object re-asserts its own flag from its `_ops/cutover/{shortlet|platform|commerce}/…` marker
    at start and before import. Check `GET /_ops/status` after step 4: all kind-scoped marker/completion pairs must agree
    with tenant history. Outside break-glass, no step here sets flags or markers. The break-glass re-closes all three at B5.

**Break-glass: rebuild into a tenant whose cutover markers exist (decided 10 Oct 2026, issue 16 item 8).** The normal rebuild is
refused by design when any marker exists. No API route clears a marker, and no route clears an object's flag. This break-glass is
for disaster recovery into the same tenant only. It needs a person with R2 write access to the production `EXPORTS` bucket
(`shortlet-pilot-production-exports`), and every step is recorded in the cutover log (cutover runbook, section 11).

Deleting the markers is not enough on its own. Each object keeps its flag in its own storage, and each start can re-create its
kind-scoped marker from that flag. The delete holds only when all three objects' storage no longer carries the flag. B3 checks this, and the rebuild
stops if the flag is still there.

- **B0. Record all markers.** The object ids are the Durable Objects' hex ids, so list and record each key by kind; do not compute them.
  `npm exec cf -- r2 objects list --bucket-name "shortlet-pilot-production-exports" --mode production --prefix "_ops/cutover/"`.
  Find `_ops/cutover/shortlet/<SHORTLET object id>.json`, `_ops/cutover/platform/<PLATFORM object id>.json` and `_ops/cutover/commerce/<COMMERCE object id>.json` for this tenant.
  If none exist, use the normal procedure; if only some exist, stop and investigate partial cutover. Read all keys and record
  each `completedAt`:
  `npm exec cf -- r2 objects get "<kind-scoped-key>" --bucket-name "shortlet-pilot-production-exports" --mode production --text`.
- **B1. Freeze and record.** Before B2, no request may reach this tenant's object: stop the Worker route or serve the freeze response
  (the mechanism is in cutover runbook, section 1). Send no import before B2: an import re-asserts the flag from a present marker,
  so an import sent first would put the flag back. Record the incident reason, the operator and the time in the cutover log.
- **B2. Delete all three markers.** Run the dry run for each exact kind-scoped key first, then delete each without `--dry-run`. Do not pass `--force`, so the CLI's
  confirmation shows the key:
  `npm exec cf -- r2 objects delete "<kind-scoped-key>" --bucket-name "shortlet-pilot-production-exports" --mode production --dry-run`.
- **B3. Check that no flag survived. Stop if any did.** List the prefix again; all three keys must be absent. Then `GET /_ops/status`.
  Expected: top-level, nested `platform.cutoverCompletedAt` and `commerce.cutoverCompletedAt` are `null`, and all markers are `absent`. Stop if any completion time
  is set. That means the corresponding flag
  survived in that object's storage. The status read does not re-create the marker, so that `cutoverMarker` may read `absent` (the object
  was already running) or `present` (the status request started the object, and its start re-created the marker). Either way, do not
  import, and do not run B4 or B5. The next import, or that object's next start, re-creates its marker and refuses
  with `CUTOVER_COMPLETE`. A rebuild into this object is then not possible under the current design; the recovery is a separate
  decision (cutover runbook, Needs user item 8).
- **B4. Rebuild.** Run steps 3 and 4 above: load the chosen day and verify all owner maps. Imports are accepted only while all
  objects' flags are clear, which is why B1 must hold.
- **B5. Re-close.** Send `POST /_ops/cutover/complete` with `-d '{}'` and the same headers as the restore route in section 1. All
  kind-scoped markers are written before their respective flags. Record all three completion timestamps; a
  repeat call returns the first values. Keep both original B0 timestamps alongside them.
- **B6. Confirm.** `GET /_ops/status` must show all markers `present` and all completion times equal to B5's values.
- **B7. Lift the freeze and log.** Only after B6. Add the log row: date, reason, operator, the original `completedAt` (B0), the B3
  result, the B5 timestamp and the step 4 counts.

**Row ordering.** The load does two things. Parents before children is required by the foreign keys (step 3). Within a
table, the import keeps the file's order: it sends rows in file order and inserts them in that order, and an upsert of
an existing row keeps that row's rowid. Reads that use `ORDER BY rowid` (for example `units`, `operators`, the revenue
journals and the enforcement records) therefore keep their relative order. Absolute rowid values are not preserved.
Rows created and then deleted within one day are in no export.

**What the rebuild does not restore.**

- Writes after the day's first alarm. Money and receipts in that gap are reconciled as described in section 3.
- Sessions and credentials. `guest_account_sessions`, `guest_session_bindings`, `guest_sign_in_codes`,
  `guest_account_email_commands`, `operator_sessions` and `operator_access_tokens` are not exported (`DAILY_EXPORT_EXCLUDED`, ADRs 0075, 0086, 0093).
  A rebuild cannot revive a session or an open sign-in challenge, so every guest and operator signs in again. A session
  revoked before the rebuild stays revoked. The same six tables are refused by `GET /_ops/export` and are not pulled or
  rolled back into Node, so sessions are re-established after a rollback as well (cutover runbook, step R5).
- Receipt bytes. The `RECEIPTS` bucket is separate and is not rebuilt from the export. The metadata rows are restored,
  so check each receipt object exists (section 3).
- Product image bytes: there is no product image bucket yet (issue 24 decision 9; the merchant back-office issue adds it). They are not in the export. Product rows restore their
  opaque image keys; verify each referenced object exists before returning Commerce storefront traffic.
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
- **Cutover state (verify with status).** A point-in-time restore rewinds each object's storage, including its one-way cutover flag,
  but not either kind-scoped marker in `EXPORTS` (issue 16 A). Each object re-asserts its flag from its marker when it starts and
  before any import, so a restore to a point before the cutover still refuses imports once the marker is read. No manual flag step
  is needed. Verify it with `GET /_ops/status` (both authentication layers), before any import or any return to service:

  ```bash
  curl -sS "$SHORTLET_OPS_URL/_ops/status" \
    -H "X-Shortlet-Ops-Secret: $SHORTLET_OPS_SECRET" \
    -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
    -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET"
  ```

  - Top-level `schemaVersion` must equal `expectedSchemaVersion`; nested `platform.schemaVersion` and `commerce.schemaVersion` must equal their migration counts.
  - If cutover had completed before the restore point, top-level, nested `platform.cutoverCompletedAt` and `commerce.cutoverCompletedAt` must not be `null`, and
    all marker fields must be `present`. Record all timestamps. Any completion time `null` while its marker is `present` is
    not a valid state: stop and report it, because that object should have re-asserted its flag.
  - Either `cutoverMarker: "unavailable"` means that marker could not be read, so every import is refused. Restore the `EXPORTS` binding
    and check again. Do not treat `unavailable` as "not cut over".
  - A restore that was meant to go back before the cutover, so that either object should accept imports again, is a decision for a
    person (issue 16, Needs user item 8). It is not available through this runbook.
  - A rebuild from exports (section 2, step 5) has the same check for all three authorities.
- **Post-restore consistency.** Before returning to service, record each of these in the log:
  1. The load of the chosen day finished with every request accepted. A `BATCH_REJECTED` (422) during the load means a child row
     was loaded before its parent, or a foreign key failed. Stop, fix the load, and start again from an empty object.
  2. `GET /_ops/import/verify` `tables[<table>].rowCount` equals the line count of that day's file for every table in
     `EXPORT_TABLES` (section 2, step 4), across the top-level SHORTLET and nested PLATFORM and COMMERCE table maps. All six excluded credential
     tables read `0` at their owning object.
  3. Because the day's files are per-table snapshots, rows written after the alarm are absent, and related rows can be
     out of step across tables. Record the day, the alarm time (from the export) and the writes the business knows of after it.
     Do not treat a matching count as proof that the tables agree with each other.
- **Operator sessions (PITR only).** A point-in-time restore brings back sessions as they were at the bookmark, so
  sessions that were revoked after it are valid again. Revoke any that were meant to be closed after the restore point
  (`DELETE /_ops/operators/:id/access`). A rebuild from exports does not restore sessions at all (section 2).

## 4. Rehearsal

The rehearsal (forcing the object to restart mid-restore, then walking these checks) is recorded in **slice 15**
along with the staging evidence.
