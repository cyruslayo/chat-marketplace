# 19 The draft-replacement card is shown after a cold restore

Status: resolved
Type: task
Track: C (one named behaviour change)
Blocked by: 10

## Defect

When the guest has a draft and picks a different unit, the shell proposes a draft replacement:
- It sets `pendingDraftReplacement`.
- It sets `activeSurfaces[DRAFT_REPLACEMENT_STAGE]`; see `apps/local-guest/src/shortlet-app.ts` near lines 5077-5079.
- It shows a confirmation card with accept and keep events (`DRAFT_REPLACEMENT_ACCEPT_EVENT` / `DRAFT_REPLACEMENT_KEEP_EVENT`).

On a cold restore, `#hydrateThreadRecord` (near line 3006) re-activates `DRAFT_REPLACEMENT_STAGE`, so the card's actions are still authorised. However, `#restoreCurrentSurface`, now routed through `restoreStage` in `apps/local-guest/src/guest-stage.ts`, has no branch for it. The guest therefore never sees the card again: it holds an authority it cannot see or act on.

## Fix

1. **Confirm the defect first.** Write a failing test that does the following:
   - Builds a draft.
   - Picks a different unit, so the replacement card appears.
   - Cold-restores.
   - Reads the restored surface.

   If the card does come back, stop and report "not a bug" with the evidence.
2. **Add a draft-replacement restore branch.** `restoreStage` gains a `draft_replacement` result when `pendingDraftReplacement` is held. Find which persisted `activeStage` or surface id the proposal leaves (`stageForSurfaceId` / `persistedActiveStage`), and keep `restoreStage` first-match ordering correct.
   - The branch rebuilds the same card through the function that rendered it live.
   - It re-keys the stored `pendingDraftReplacement.surfaceId`; never mint a new id (ADR 0106).
3. **Keep the card's actions fail closed.**
   - Accept and keep on the restored card work.
   - An action carrying a superseded or forged surface id is still refused (`STALE_SURFACE`).

## Acceptance criteria

1. After a cold restore, a thread with a pending draft replacement shows the replacement card, under the same surface id as before the restore.
2. Accept on the restored card replaces the draft, exactly as it does on the live card. Keep leaves the original draft, exactly as on the live card.
3. A replacement action with a forged or superseded surface id is refused with `STALE_SURFACE` after a restore.
4. A thread with no pending replacement restores exactly as before. The issue 10 matrix is unchanged.

## Tests

- **New test file:** `test/draft-replacement-cold-restore.test.ts`.
  - Assistant enabled.
  - Cold restore before every event.
  - 2026-10-27 clock.
  - Guest with no seeded phone or email.
  - Reuse the draft-revision helpers. Search `test/` for `draft-replacement`, `pendingDraftReplacement`, `guest-draft-revision` and `assistant-proposal-replacement`.
- **Run from `/c/AI2026/chat-marketplace-sm-19`:**
  - `env -u LLM_API_KEY npx tsx --test test/draft-replacement-cold-restore.test.ts test/guest-stage-projection.test.ts test/guest-draft-revision.test.ts test/assistant-draft-revision.test.ts test/assistant-proposal-replacement.test.ts test/guest-process-restart.test.ts test/assistant-cold-journey.test.ts test/state-machine-inventory.test.ts`
  - Then `npm run check`.

ADRs: 0074, 0106.

## Comments

**Step 1, before the fix (unchanged src).** `env -u LLM_API_KEY npx tsx --test test/draft-replacement-cold-restore.test.ts`: 5 tests, 1 pass, 4 fail. AC1, AC2 accept, AC2 keep and AC3 fail with `a card is shown after the restore`. AC4 passes (baseline). The defect is confirmed: the live proposal persists `activeStage` `draft_replacement` (surface id `:request:replacement:`), `restoreStage` had no branch for it, so `#restoreCurrentSurface` returned no card.

**Scope note (for the owner).** The issue says "picks a different unit". The live replacement never changes the unit: `#proposeDraftReplacement` and `proposeDraftRevision` quote the draft's own `unitId` with a new stay. The test therefore uses the planner's "make it 3 nights", the only way the card is proposed. If a unit-change replacement is in scope, that is a new C issue, not this one.

**ADR table (step 2 and verify).**

| ADR | Constraint | Where it is reflected |
|---|---|---|
| 0074 | Surface lifecycle fail closed; accept and keep bind to the held draft and surface | Restore branch shows the card only when `basedOnDraftId` equals the held draft and no request or offer exists; AC3 forged and superseded ids return `STALE_SURFACE` |
| 0106 | Cold restore before every event; re-key, never mint | Card is rebuilt under the stored `pendingDraftReplacement.surfaceId`; every test runs a new `LocalGuestApp` per event |
| 0080 | Assistant path is the guest's conventional route | Unchanged; accept and keep still go through the existing handlers |

**Fix.**
- `apps/local-guest/src/guest-stage.ts`: `restoreStage` takes an optional `pendingDraftReplacement` flag and returns `draft_replacement`. The branch is last, and the optional flag keeps the issue 10 matrix unchanged.
- `apps/local-guest/src/shortlet-app.ts`: `#restoreCurrentSurface` gains the `draft_replacement` branch. It returns the card only when the held replacement is for the draft on screen.
- `apps/local-guest/src/shortlet-app.ts`: the card build moved out of `#presentDraftReplacement` into `#draftReplacementCard`, so the live proposal and the restore share one renderer. The live path's output is unchanged.

**Tests.**
- New `test/draft-replacement-cold-restore.test.ts` (5 tests, one per AC plus the AC2 keep case).
- New `test/helpers/assistant-draft-journey.ts`: the journey helpers moved out of `test/assistant-draft-revision.test.ts`. The test bodies are unchanged, checked by diff.
- New unit test in `test/guest-stage-projection.test.ts`, "AC4 (issue 19)", for the new `restoreStage` row. The existing AC2 matrix test is not edited.

**Commands and counts after the fix (from `C:\AI2026\chat-marketplace-sm-19`).**
- `env -u LLM_API_KEY npx tsx --test test/draft-replacement-cold-restore.test.ts`: 5 pass, 0 fail.
- `env -u LLM_API_KEY npx tsx --test test/assistant-draft-revision.test.ts test/draft-replacement-cold-restore.test.ts`: 16 pass, 0 fail.
- The issue's command (8 files): 82 pass, 0 fail, 0 `not ok`.
- `env -u LLM_API_KEY npm run check`: exit 0 (run before and after the new unit test).

**Definition of Done.**
1. Each AC has a named test that mirrors its text.
2. Failure paths are asserted: forged surface id, superseded surface id after accept, no pending replacement.
3. ADRs 0074, 0106 and 0080 are listed above.
4. No injected dependency was added.
5. No policy string or constant was added.
6. No logging or audit record was added.
7. `npm run check` passes. Full `npm test` is not run here; it is the batch pre-merge gate, per the owner's test scope.

**Not verified.** No live staging check and no Browser-pane check were run, because this worktree has no running guest. The `state-machines.md` row for `restoreStage` already says the branch choice lives in that function, so no doc row changed (no new state field was added).
- Orchestrator review: restore branch keys on its own persisted stage (no shadowing) and only rebuilds for the same draft; one shared renderer for live and restore. Re-ran the 8 files and `npm run check` (exit 0). Scope note kept: the live replacement re-quotes the same unit, so a unit-change replacement is not in scope.
