# 16 Stale draft pointer after a new search

Status: resolved
Type: task
Track: C
Blocked by: 10

## Answer

Merged into issue 18 (2026-11-18). The plan was to clear `draftId` when a new search starts. That is unsafe: the draft-replacement prompt (`pendingDraftReplacement` in `apps/local-guest/src/shortlet-app.ts`) relies on the earlier draft surviving a new search.

The visible defect is that `#guestStage` reports "draft" while the rail says "search" (matrix rows D1 and D2 in issue 10). That is a stage-rule disagreement, not a data problem, so issue 18 fixes it in `apps/local-guest/src/guest-stage.ts` and keeps the stored `draftId`.

## Comments
