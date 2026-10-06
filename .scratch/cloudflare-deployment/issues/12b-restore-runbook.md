# Restore runbook

Status: ready-for-agent
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
