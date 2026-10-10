# Restore runbook

Status: resolved
Type: task
Blocked by: 10b
Branch: `infra/cf-12b-restore-runbook`
Requested: 2 Oct 2026
Unlocks: 15

## Why

The production database becomes a Durable Object. Operators need a tested way to restore it to a point in time, and to rebuild it from the JSONL exports if point-in-time recovery is not enough.

## What to build

- `docs/runbooks/cloudflare-restore.md` (create the folder if needed; first check whether pilot runbooks already live under `docs/`, and put it next to them):
  - **PITR:** use `ctx.storage.getBookmarkForTime(time)` and `onNextSessionRestoreBookmark(bookmark)`, then restart the object. Cover the 30-day window, how to pick the time, and what happens to writes made after it.
  - Trigger it through an authenticated `/_ops/restore` route (11a's authentication, two-step: a dry run that returns the bookmark, then a confirm), or through a documented one-off script. Pick one and justify it. If it's a route, implement it here with tests.
  - **Rebuild from exports:** the steps to load 12a's JSONL into a fresh object through `/_ops/import` (slice 16 builds that route; reference it).
  - After any restore: check `/healthz`, the row counts, the Paystack reconciliation for payments made after the restore point, and receipts (R2 is not rolled back).
- Record the rehearsal itself in slice 15.

## Out of scope

- Running the staging drill (15).

## Acceptance criteria

- AC1: The runbook covers PITR, rebuild from exports, post-restore checks, and payments and receipts made after the restore point.
- AC2: If a route is implemented, it refuses requests without both authentication layers, and needs an explicit confirm step. Failure path: a confirm without a prior dry-run bookmark is refused.
- AC3: In workerd tests (if a route), restoring to a bookmark taken before a write makes that write disappear after the restart.
- AC4: `npm run test:workers`, `npm test` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0045 / 0089 | Money after the restore point must be reconciled, never lost | runbook post-restore checks |
| 0079 | Replayable | rebuild from exports |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments
### Issue 16 pass 4 (10 Oct 2026): rebuild from exports corrected and tested

- **Section 2 was wrong in two ways.** It said to load each day "oldest day first". Each day's objects are full snapshots, and the import upserts and never deletes, so that would resurrect rows deleted later. Section 2 now says to load one day, the newest complete one. It also said rowid order was "preserved" by a manual insert, which the import route does not do on its own. Section 2 now states exactly what the import keeps: file order within a table, and the rowid of an upserted row.
- **Foreign keys.** The object enforces foreign keys (`PRAGMA foreign_keys = 1` in workerd, checked). A child row whose parent is not loaded yet is refused with `422 BATCH_REJECTED`. The load therefore runs parents first, in the order `importOrder()` (`packages/platform-core/src/data-migration.ts`) returns. The same ordering now governs the cutover manifest, which the push reads in key order. Before this pass the manifest was alphabetical, which put `guest_account_email_commands` ahead of `guest_accounts`. The Node test "16 D1 cutover: the manifest lists each parent table..." failed on that order before the fix.
- **What cannot be restored** is now stated: writes after the day's first alarm, sessions and sign-in challenges (not exported), receipt bytes (R2 is separate), and the cutover flag (a control table, so the runbook says to call `POST /_ops/cutover/complete` again after a rebuild on a cut-over object).
- **Test.** `apps/cloudflare/test/restore-from-export.spec.ts`: "16 restore: a day's export loaded parent-first into a new object exports the same bytes for every exported table" (the reference load loop; it also checks the FK order) and "16 restore: loading every day oldest first keeps a row deleted after the older day..." (why only one day is loaded). The rebuild path and the import route are the ones the runbook names; the packaged loader for a day export does not exist and is not added here.
- **PITR (AC3).** Unchanged: the workerd pool still has no point-in-time recovery, so the bookmark round trip is still proven on staging only (issue 15).


## Answer

Resolved 7 Oct 2026 on `infra/cf-12b-restore-runbook`.

### Runbook

`docs/runbooks/cloudflare-restore.md` covers AC1 in full: the 30-day PITR window and how to choose the restore time; the two-step `/_ops/restore` route (dry run returns the bookmark, confirm carries it back); what happens to writes made after the restore point; rebuilding from 12a's `YYYY-MM-DD/<table>.jsonl` exports through the slice-16 `/_ops/import` route (referenced, with the manual fallback until 16 lands); and the mandatory post-restore checks — `/healthz`, row counts, **Paystack reconciliation for payments after the restore point** (ADRs 0045/0089) and the note that **`RECEIPTS` (R2) is not rolled back** so a receipt can outlive its metadata row and be swept by 12a. The rehearsal is assigned to slice 15.

### Option chosen: an authenticated route, not a script

The bookmark APIs live on the Durable Object's `ctx.storage`, so a one-off script would still have to reach into the object and would need its own auth and tests. The route reuses 11a's two fail-closed layers and adds the explicit confirm; it is implemented in `ops-routes.ts` (`POST /_ops/restore`) with `OpsStorageBookmarks` injected from `this.ctx.storage`.

### Acceptance evidence

- **AC2** (`apps/cloudflare/test/ops-restore.spec.ts`): a handler built with a stubbed bookmark authority refuses a request with no layers (`401`), with the Access layer failing (`401`) and with the shared secret missing (`401`); a dry run returns the bookmark with `Cache-Control: no-store`; **a confirm without the dry-run bookmark is refused (`400`)**; a confirm carrying it returns `{ ok: true, scheduled: true, restartRequired: true }`. The deployed route refuses an unauthenticated request (`401`) and a confirm with no bookmark (`400`).
- **AC3 — NOT verifiable in workerd, recorded.** The Vitest pool's Durable Object storage back-end **does not implement point-in-time recovery**: `ctx.storage.getBookmarkForTime` rejects with "This Durable Object's storage back-end does not implement point-in-time recovery". The bookmark round trip therefore cannot be proven locally; the test asserts this documented limitation and the rehearsal must happen on staging (slice 15), where the real back-end provides PITR.
- **AC4**: `npm run check` clean; `npm run test:workers` passes **48** workerd tests.

### Notes

- `cf` cannot deploy or run here (the Windows spawn gap recorded in 10b), so no live restore was attempted; the route is the documented, tested trigger.
