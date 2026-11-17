# 10 deriveGuestStage: one projection that keeps today's results

Status: ready-for-agent
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
