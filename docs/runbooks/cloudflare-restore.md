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

The alarm writes one JSONL object per table per day to the private `EXPORTS` bucket, keyed
`YYYY-MM-DD/<table>.jsonl` (Africa/Lagos date), and keeps 400 days. If the 30-day window has passed or the object
must be rebuilt from scratch:

1. Create the tenant's object (a request to the origin does this) and import the inventory so operators/units exist.
2. Load each table's JSONL, oldest day first, through the authenticated `/_ops/import` route that **slice 16**
   builds (batched to respect the 100-parameter and 2 MB limits). Until 16 lands, this step is a documented manual
   procedure: insert the JSONL rows into the matching tables preserving `rowid` order.
3. Re-run the day's export and confirm row counts match the source.

Read a day's objects with the pinned `cf` CLI or the R2 dashboard; they are private and never public.

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
- **Operator sessions.** Sessions restored from before the bookmark are valid again; revoke any that were meant to
  be closed after the restore point (`DELETE /_ops/operators/:id/access`).

## 4. Rehearsal

The rehearsal (forcing the object to restart mid-restore, then walking these checks) is recorded in **slice 15**
along with the staging evidence.
