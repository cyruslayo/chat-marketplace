# 10 deriveGuestStage: one projection that keeps today's results

Status: resolved
Type: task
Track: B (no behaviour change)
Blocked by: 01

## What to build

The guest's booking stage is never stored as one value. It is re-derived in about 9 places, and those derivations disagree:

- `apps/local-guest/src/shortlet-app.ts`: `#guestStage`, `#journeyFor`, `#stageForSurfaceId`, `#inferActiveStage`, the stage choice inside `#restoreCurrentSurface`, and `#safeAssistantTimelineMessage`.
- `apps/local-guest/src/assistant/shortlet-assistant-pack.ts`: `dateShowBackFor`, `shortletTaskSummary`, `sentStageFor`.

This issue only makes the derivation explicit and testable. **It must not change what any site returns.** Fixing the disagreements is issue 18, one row at a time.

1. **Characterisation matrix first.** Create `test/guest-stage-projection.test.ts`.
   - Build guest threads at each stage: discovery, unit, draft, request, offer issued, offer accepted, payment surface, booking confirmed, and draft after a new search.
   - Use real flows and the existing helpers (`withStagePage`/`withRequestScreen` in `test/helpers/`, `test/guest-process-restart.test.ts`, `test/assistant-cold-journey.test.ts`).
   - For each thread, record what every site returns, through public outputs: the rail in the response, the task-rail summary, the capability reply and the restored surface.
   - Run the matrix with the assistant enabled and a cold restore (a new `LocalGuestApp` over the same store) before each event, the 2026-10-27 clock, and a guest with no seeded phone or email (ADR 0106).
   - The matrix must pass before you change any code. Write down every row where sites disagree in the issue Comments; issue 18 takes them from there.
2. **Pure module.** Create `apps/local-guest/src/guest-stage.ts`, modelled on `apps/local-guest/src/agent-mark-state.ts`:
   - an exported `GUEST_STAGES` const array and a `GuestStage` type;
   - a `GuestStageInputs` interface (the plain facts: ids present, which active surfaces, offer status, payment status, booking snapshot present);
   - one pure function per current derivation rule, named for its site (for example `stageForCapabilityReply`, `stageForJourneyRail`), each reproducing that site's current logic exactly.
   - Leave `#stageForSurfaceId`'s string parsing as a pure function there too.
3. **Wire the sites.** Each of the 9 sites builds `GuestStageInputs` and calls its function. No site may change its result; the matrix proves it.
4. **Map.** Add the names in backticks to the guest-stage row of `docs/agents/state-machines.md`.

Do not clear `draftId` (issue 16), do not change the task rail's "pay" step (issue 18), and do not add a draft-replacement restore branch (issue 19).

## Acceptance criteria

1. The characterisation matrix passes unchanged before and after the refactor, with the assistant enabled and a cold restore before every event.
2. Every derivation site calls a pure function from `guest-stage.ts`. A test imports each function and checks it against matrix rows.
3. Every disagreement between sites is listed in Comments, with the thread state and each site's result.
4. `test/assistant-cold-journey.test.ts`, `test/guest-journey-rail.test.ts`, `test/guest-process-restart.test.ts` and `test/assistant-booking-journey.test.ts` still pass, and `npm run check` is clean.

## Tests

As in the acceptance criteria, plus `test/state-machine-inventory.test.ts`. Do not run real-Chrome tests.

ADRs: 0004, 0074, 0106, 0107. Read ADR 0106 in full first, then AGENTS.md "Concierge assistant path".

## Comments

**Step 1 (characterisation matrix, before any change to `src`).** The matrix is `test/guest-stage-projection.test.ts`. It runs each state on a fresh thread with the assistant runtime enabled, the 2026-10-27 clock and a staging-like guest (no phone or email), and reads every site through a new `LocalGuestApp` over the same store before each read or event. The unclear-turn reply and timeline entry are read after a cold restore too. Every state is built with real turns and taps.

- Pre-refactor green run (unchanged `src`): `env -u LLM_API_KEY npx tsx --test test/guest-stage-projection.test.ts` gave 1 pass, 0 fail (test duration about 222 s; it uses the real flows, so it is slow).
- Pinned cells are the observed values. Random ids (draft, request, offer and reservation ids) are normalised in the surface id only.

Disagreements found on unchanged code (pinned as they stand; issue 18 fixes them):

| Thread state | Journey rail (`#journeyFor`) | Task rail (`shortletTaskSummary`) | Persisted `activeStage` (`#stageForSurfaceId`) | Reply to an unclear turn (`sentStageFor`) | Criteria lock (`#guestStage`) |
|---|---|---|---|---|---|
| discovery | search | Stay | discovery | fixed clarification | not sent |
| unit | stay | Stay | unit | fixed clarification | not sent |
| draft (no search since) | request | Request | request | fixed clarification | not sent |
| draft after a new search | search | Request | discovery | fixed clarification | not sent |
| request sent | request | Request | request | Booking Request copy | request copy |
| offer issued | offer | Offer | offer | Offer copy | offer copy |
| offer accepted (payment surface) | pay | Offer | payment | payment copy | payment copy |
| booking confirmed | confirmed | Confirmed | booking | booking copy | booking copy |

- **D1, draft after a new search.** Three sites disagree about the same thread. The rail says Search, the task rail says Request, and the persisted stage says discovery. `#guestStage` (not observable through the public output here) returns `draft`, because the `draftId` is kept with no request or offer (issue 16: a new search does not clear it).
- **D2, draft with no new search.** The rail says Request (the draft is the surface on screen). `#guestStage` returns `draft`, which is not the same stage. The rail, the persisted stage and the task rail say request, so `#guestStage` is the outlier. Not observable through the public output here (capability reply not reached), so the pure function is tested directly.
- **D3, accepted offer on the payment surface.** The journey rail says `pay`, but the task rail says `Offer` (because `shortletTaskSummary` only checks `currentOfferId`, not the payment), and `sentStageFor` returns `payment`. The task rail is the outlier against both.
- No disagreement across the sent rows for the criteria lock: `#guestStage` and the rail agree there.
- Not reached through the public outputs: `#safeAssistantTimelineMessage` returns the `detailsReady` and `draftReady` copy, which the unclear-turn path does not reach. `dateShowBackFor` (the draft show-back) needs a pending date show-back and is not reached either. `#inferActiveStage` is used only when a surface id names no stage, and none of the matrix surfaces are like that. These three are tested through their pure functions.
- Not a stage disagreement: the timeline copy for sent rows is the generic "current booking information" sentence, not each stage's copy. Recorded for issue 18's copy work.

**Steps 2 and 3 (pure module and wiring).** The pure module is `apps/local-guest/src/guest-stage.ts`. Routed sites (each calls a pure function; no result changed, and the matrix stayed green unchanged):

- `#guestStage` (shortlet-app.ts) calls `stageForGuestThread`, with inputs built by `#stageInputs`.
- `#stageForSurfaceId` (shortlet-app.ts) is replaced by `stageForSurfaceId` at every call site, and the method is removed.
- `#inferActiveStage` (shortlet-app.ts) is replaced by `inferActiveStage`, through `persistedActiveStage` at the two save sites (`#persistThread`, `#persistRemoteThread`).
- `#journeyFor` is **partly routed**: only its tail (stay, then a kept draft on screen, then search) calls `journeyTailStep`. The offer and request branches stay inline (they read artifacts lazily, inside a try).
- `#safeAssistantTimelineMessage` calls `timelineCopyKey` for the copy choice. The copy text stays in the method.
- `dateShowBackFor` (assistant pack) calls `dateShowBackStage`.
- `shortletTaskSummary` (assistant pack) calls `shortletTaskStatus`, and the labels stay in the pack.
- `sentStageFor` (assistant pack) calls `sentStage`. The offer is read only when an offer is held and no booking exists, as before.
- **Not routed:** the stage choice inside `#restoreCurrentSurface` (its branches dispatch on the persisted `activeStage` and artifacts, interleaved with try/catch). It stays inline.

So AC2 was **not met at this point**; the round-2 entry below completes it.

**Round 2 (coordinator follow-up): the last two sites are routed.**

- `#journeyFor` now calls `journeyRailStep` for the whole offer and request branch, with the same lazy reads in the same order (`bookingSnapshotHeld`, `offerStatus`, `paymentStatus`, `requestFacts`, each read only where the site read it). The labels are computed in the method from the decision. The method keeps its `try`, so a throwing read still ends the rail as before. The tail still calls `journeyTailStep`. Fully routed.
- `#restoreCurrentSurface` now calls `restoreStage` once, from the projection alone, before the `try`. `restoreStage` returns the first branch whose guard matches, in the same order and with the same conditions. Each branch body is untouched. Each guard repeats the fact it narrows (for example `projection.discoveryArtifact`), because the type narrowing had come from the old guards. `restoreStage` already established that fact, so the repeated test is always true when its branch matches. Fully routed.
- No branch outcome changed. The matrix passed unchanged, and the new pure tests cover the matrix rows and the failure paths.

Pure-function tests added: `AC2: journeyRailStep gives each matrix row's rail decision, reads lazily, and fails through to the tail when neither is held`, and `AC2: restoreStage gives each matrix row's restore branch, and none without the facts its guard reads`.

Round-2 run: `env -u LLM_API_KEY npx tsx --test test/guest-stage-projection.test.ts test/assistant-cold-journey.test.ts test/guest-journey-rail.test.ts test/guest-process-restart.test.ts test/assistant-booking-journey.test.ts test/state-machine-inventory.test.ts test/assistant-pending-action-restore.test.ts test/offer-restore-status.test.ts`: 69 pass, 0 fail, 0 cancelled, 0 skipped. The matrix (AC1) is in that set and passed unchanged.

All nine sites now call a pure function from `guest-stage.ts`:
1. `#guestStage`: `stageForGuestThread`.
2. `#journeyFor`: `journeyRailStep` (offer and request) and `journeyTailStep` (tail).
3. `#stageForSurfaceId`: `stageForSurfaceId`.
4. `#inferActiveStage`: `inferActiveStage`, through `persistedActiveStage`.
5. `#restoreCurrentSurface` stage choice: `restoreStage`.
6. `#safeAssistantTimelineMessage`: `timelineCopyKey`.
7. `dateShowBackFor`: `dateShowBackStage`.
8. `shortletTaskSummary`: `shortletTaskStatus`.
9. `sentStageFor`: `sentStage`.

Status is therefore `resolved`. The full `npm test` is the batch gate (AGENTS.md Test scope), so it was not run per issue.

Commands and counts (run from `C:\AI2026\chat-marketplace-sm-10`, each prefixed `env -u LLM_API_KEY`):

- Pinned matrix on unchanged `src`: `npx tsx --test test/guest-stage-projection.test.ts` gave 1 pass, 0 fail.
- Required set after the refactor: `npx tsx --test test/guest-stage-projection.test.ts test/assistant-cold-journey.test.ts test/guest-journey-rail.test.ts test/guest-process-restart.test.ts test/assistant-booking-journey.test.ts test/state-machine-inventory.test.ts` gave 57 pass, 0 fail, 0 cancelled, 0 skipped. This includes the matrix (AC1), the 8 AC2 pure-function tests, the cold journey, the rail, the restart and booking journeys, and the inventory ratchet. This run started before a whitespace-only blank-line removal in `shortlet-app.ts`.
- `npm run check` (`tsc --noEmit` on the root, cloudflare and tooling projects, plus the Worker bundle guard): exit 0 on the final tree, after that removal.
- Not run: the full `npm test` (batch gate, AGENTS.md Test scope), `npm run test:workers` (no Worker code changed) and any real-Chrome test.

Definition of Done, checked for this pass:

1. Each AC has a named test: AC1 is `AC1: The characterisation matrix passes unchanged ...`; AC2 has one test per pure function. AC3 is this list. AC4 is the required set above.
2. Failure paths: `stageForSurfaceId` fails closed on an unknown id, `shortletTaskStatus` falls back to search, `sentStage` gives undefined before anything is sent, and `timelineCopyKey` falls back to the clarification.
3. ADRs read in full: 0106 and 0074 (plus AGENTS.md and the coding standards). ADRs 0004 and 0107 are named in the issue and the map but were not re-read in full in this pass.
4. No unused injected dependency: the pure module takes plain inputs only, and every export is used.
5. No policy string or constant invented: the copy and the labels are unchanged, and only moved.
6. No bearer credential in a log or audit record: nothing new is logged.
7. `npm run check` is clean. The full `npm test` is the batch gate, so it is not run here.

Map: the guest-stage row of `docs/agents/state-machines.md` names `GUEST_STAGES`, `GuestStage` and each pure function. The ratchet test (`test/state-machine-inventory.test.ts`) passed.
- Orchestrator review: guest-stage.ts read; restore branch choice is equivalent (each guard keys on a distinct activeStage, draft/request exclusive). Re-ran the 8 files (69 pass, matrix unchanged) and `npm run check` (exit 0).
