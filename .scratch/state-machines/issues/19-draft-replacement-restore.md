# 19 The draft-replacement card is shown after a cold restore

Status: ready-for-agent
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
