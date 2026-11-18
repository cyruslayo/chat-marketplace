# 18 One guest stage everywhere

Status: ready-for-agent
Type: task
Track: C. Three named behaviour changes, one commit each; the orchestrator commits.
Blocked by: 10, 11, 13 (all resolved). Absorbs issue 16.

## Defect

Issue 10's characterisation matrix (`test/guest-stage-projection.test.ts`) pins three places where the stage functions in `apps/local-guest/src/guest-stage.ts` disagree for the same thread. Read the D1-D3 table in `.scratch/state-machines/issues/10-derive-guest-stage.md` first.

- **D1. A new search after a draft.** The journey rail says Search and the persisted stage says discovery. The task rail (`shortletTaskStatus`) still says Request, and `stageForGuestThread` says draft. The draft is no longer on screen.
- **D2. A draft with no new search.** The rail, the task rail and the persisted stage all say request. `stageForGuestThread` alone says draft.
- **D3. An accepted offer on the payment surface.** The rail says pay and `sentStage` says payment. The task rail alone says Offer.

## Fix

Make the outlier agree with the majority. Do each disagreement as its own change and stop between them: finish D3, leave the tree green, then D2, then D1. Never clear or re-mint stored ids such as `draftId` (ADR 0106); the draft-replacement prompt depends on `draftId`.

- **D3.** `shortletTaskStatus` returns the payment step for an accepted offer. Its inputs gain the offer-accepted fact, the same fact `sentStage` reads.
  - The task-rail label must come from an existing label. Find how the rail labels the pay step (`journey-rail.ts`) and the task-rail labels in `shortlet-assistant-pack.ts`. Reuse an existing "Pay" or "Payment" label; do not write new copy.
  - If no existing label fits, stop and report rather than inventing one.
- **D2.** `stageForGuestThread` returns `request` where the other sites do: a draft that is the surface on screen. Check what `#guestStage` drives (the capability reply near `shortlet-app.ts:1041`, the criteria lock near :1155 and :4455), and confirm that "request" there gives the same guest-facing result as the other sites. If the capability reply or the criteria lock would change in a way the guest sees, say exactly how in Comments.
- **D1.** After a new search, `stageForGuestThread` and `shortletTaskStatus` agree with the rail: search or discovery. A held `draftId` alone, with the draft not on screen and no request or offer, no longer counts as the draft stage.
  - Keep the stored `draftId`.
  - Confirm that the draft-replacement prompt still appears when the guest picks a new unit after the search. Search `test/` for `pendingDraftReplacement` and `draft-replacement`.

## Acceptance criteria

1. The guest sees the payment step on the task rail for an accepted offer on the payment surface, matching the journey rail. (D3)
2. With a draft on screen and no new search, every site gives the same stage. (D2)
3. After a new search that follows a draft, every site gives search or discovery, and the stored `draftId` is unchanged. (D1)
4. After D1, the draft-replacement prompt still appears when the guest picks a different unit and has a draft.
5. The rest of the matrix is unchanged: only the D1-D3 cells move. Update those cells, and no others, in `test/guest-stage-projection.test.ts`.

## Tests

- **Harness for every new test:** assistant enabled; a cold restore before every event (a new `LocalGuestApp` over the same store); the 2026-10-27 clock; a guest with no seeded phone or email (ADR 0106).
- **Run** from `/c/AI2026/chat-marketplace-sm-18`:
  - `env -u LLM_API_KEY npx tsx --test test/guest-stage-projection.test.ts test/assistant-cold-journey.test.ts test/guest-journey-rail.test.ts test/guest-process-restart.test.ts test/assistant-booking-journey.test.ts test/assistant-draft-revision.test.ts test/guest-draft-revision.test.ts test/assistant-proposal-replacement.test.ts test/state-machine-inventory.test.ts`
  - plus any test whose name contains `task-rail`, `task-summary` or `draft-replacement`.
- **Then** run `npm run check`.
- **Captures (UI-visible, AGENTS.md "Guest UI work"):**
  - After D3, capture the task rail with an accepted offer at 320, 390, 768 and 1280 (light), using `.scratch/guest-ui-consistency/capture.ts` against the walkthrough.
  - Save them under `.scratch/state-machines/screenshots/18/`.
  - Check that nothing overflows horizontally and that no control is under 44px.
  - Run captures alone; no other browser run at the same time.

ADRs: 0004, 0074, 0106, 0107.

## Comments
