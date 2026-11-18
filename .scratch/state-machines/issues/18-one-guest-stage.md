# 18 One guest stage everywhere

Status: resolved
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

**Step D3 (accepted offer on the payment surface): done, counts below.** Status stays `ready-for-agent`: D2 and D1 are not done.

- Red first: `env -u LLM_API_KEY npx tsx --test --test-name-pattern "shortletTaskStatus|task rail shows the payment" test/guest-stage-projection.test.ts` gave 0 pass, 2 fail (`expected 'payment', actual 'offer'`). The matrix cell was repinned to "Pay" before the code change, but the full matrix was not run red, and the harnessed AC1 test was added after the change, so its red run was not observed.
- Change: `ShortletTaskInputs.offerAccepted` added. `shortletTaskStatus` returns `payment` for an accepted offer with no booking. `shortletTaskSummary` (`shortlet-assistant-pack.ts`) labels `payment` with the existing `GUEST_JOURNEY.pay` ("Pay"). New copy: none. `railOfferAccepted` reads the offer only when one is held and no booking exists, as `sentStage` does, and returns "not accepted" on a read error (fail closed, rail side only). `sentStageFor` keeps its original read.
- Matrix cells changed: only `payment-surface` task status, "Offer" to "Pay". No other cell moved. The pure `shortletTaskStatus` input literals gained `offerAccepted: false`; these are inputs, not cells.
- Other pins: no test pins the task-rail "Offer" on an accepted offer. `test/guest-task-rail-chromium.test.ts` pins no status label (real Chrome, not run). The "Offer" hits in `guest-offer-consistency*.test.ts` and `guest-amount-labels.test.ts` are journey-stage labels for an issued offer; I did not run them.
- Counts: pure pattern run after the change: 2 pass, 0 fail. `npm run check`: exit 0 (after the change and again after the fixes). Required set plus `test/assistant-task-rail.test.ts` (the only file named `task-rail`; the Chromium file is excluded): `env -u LLM_API_KEY npx tsx --test test/guest-stage-projection.test.ts test/assistant-cold-journey.test.ts test/guest-journey-rail.test.ts test/guest-process-restart.test.ts test/assistant-booking-journey.test.ts test/assistant-draft-revision.test.ts test/guest-draft-revision.test.ts test/assistant-proposal-replacement.test.ts test/state-machine-inventory.test.ts test/assistant-task-rail.test.ts`: 96 pass, 0 fail, 0 cancelled, 0 skipped. An earlier run with the offer read on the shared helper gave 95 pass; the read was then moved to the rail side, and the 96 run is the current code.
- Captures (AC, D3): not taken. Walkthrough on port 3024 (payment choice) ran and was stopped; its scratch log was deleted; ports 3021 to 3028 are free again. The shell task rail renders only with two or more tasks (`client.ts` `renderTaskRail` hides it at `tasks.length <= 1`). The walkthrough guests have one stay task, and a second task needs a second registered pack. The commerce pack registers only when `COMMERCE_ENABLED` is `"true"` (off). So the rail with "Pay" cannot appear in this deployment, and a capture would not show the change. The journey rail on that page reads "Pay (current step)" (checked in the browser at 1280, not saved). At 320 the focused payment view hides the journey rail. Nothing was saved to `.scratch/state-machines/screenshots/18/`.

**Step D2 (draft with no new search): stopped, no change made.** Making `stageForGuestThread` return `request` for a draft on screen changes what the guest sees, so per the orchestrator's rule the step stops here. No `src` change and no failing test were left behind.

- Consumers of `#guestStage`: (1) `#stageReply` (`shortlet-app.ts`, about line 1154) branches on the stage. A draft takes the first branch, which returns null for non-amenity turns, so the turn falls through to discovery and to `#proposeDraftReplacement`. A `request` stage takes the second branch: a stay-change turn gets the request change explanation ("can't be changed while ... reviews it"), and any other turn with no amenity answer gets `guestCapabilityReply("request")`, which says "Your Booking Request is with ... for review". Both are false for an unsent draft. The second branch also returns before `#proposeDraftReplacement` and the discovery flow, so a guest with an unsent draft could no longer search again or get the replacement prompt. (2) `#refreshWorkflow`'s empty-message path (about line 1040) calls `#capabilityReply(#guestStage)`. A draft is "current" today ("Everything so far is in your stay details."), and would become the request copy. (3) `#criteriaGuard` (about line 4455) reads the stage only when `requestId` or `offerId` is held, so the criteria lock is not affected.
- Reach: `#stageReply` runs on every turn when no assistant runtime is configured. With the assistant on, it runs only when `providerUnavailable` (`#handleTurn`, about lines 1005 to 1021).
- To keep today's results, `#stageReply` and `#capabilityReply` would have to key on `requestId`, not on the stage. That is outside this step's allowed edit, and it is the owner's call.

**Step D1 (draft after a new search): not implemented; stopped on AC3.** Checks run before any test was written:

- Shell side: the discriminator is the last surface's stage (`stageForSurfaceId` of the last surface, as `journeyTailStep` already uses). `activeSurfaces` does not discriminate: `#prepareDiscovery` sets the discovery surface and never removes `request` (`shortlet-app.ts` about line 1239), so a draft surface can stay in the map after a new search. This is from a code read, not a run. A shell fix would need a new `lastSurfaceStage` input to `stageForGuestThread`.
- Pack side (task rail): no existing field discriminates. `AssistantTaskState` holds no surface. A new search (`shortlet-assistant-pack.ts` about lines 1183 to 1184) sets the shortlist and clears `selectedStayRef`, but viewing another unit sets `selectedStayRef` again (about line 1243), so it cannot mean "draft on screen". `currentDraftId` is never cleared (not touched, per the brief). A fix needs either a new persisted field or passing the shell's last surface into `taskSummary`, a contract change. Not done.
- Expected cell, if the pack side is fixed: after a new search the task has a shortlist, so the discovery row's "Stay" would apply, not "search". AC3 ("search or discovery") conflicts with AC5 for the task rail, whose vocabulary is stay/request/offer/payment/confirmed/search with no discovery. The owner should settle that wording.
- AC4 (draft-replacement prompt): `#proposeDraftReplacement` guards on `thread.draftId`, `requestId` and `offerId` (`shortlet-app.ts` about line 4945). `shortlet-draft-revision.ts` keys on `currentDraftId`. Neither reads `#guestStage`, so the prompt is not tied to D1's stage change. Tests that cover it: `test/assistant-draft-revision.test.ts`, `test/guest-draft-revision.test.ts`, `test/assistant-stage-handlers.test.ts`, `test/assistant-tool-argument-validation.test.ts`, `test/guest-stage-projection.test.ts`, `test/helpers/parity-fixture.ts`. Not run for D1, since no D1 change was made.
- Orchestrator decision (2026-11-18): D3 done and committed. D2 closed as by design: `#guestStage` = draft is what correctly drives the shell replies; the rail's Request step includes drafts, so the cells differ in meaning, not in fact. D1 moves to issue 28 (needs-info): the task rail needs a new persisted discriminator and wording, which is an owner decision. D3 has no visible effect today: the task rail renders only with two or more tasks, and commerce is off. Re-ran 5 files and `npm run check` (exit 0).
