# Assistant: explain why a sent request, offer or booking can't change in chat

Status: resolved
Type: AFK
Blocked by: none
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

After a request is sent, the deterministic path answers "make it 4 nights" with `#changeExplanation` (`shortlet-app.ts:1152`): what can't change, why, and what to do instead, ending "Nothing has been changed." (ADR 0005, 0060). The assistant has no equivalent copy; the model may start a new search or imply the booking changed.

## What to build

- Move the four explanation strings to `guest-content.ts`.
- When the task state has a sent request, an offer, a payment or a reservation, and the guest asks to change stay facts, the pack answers with the matching explanation and commits no stay change. The pack decides the stage from the task state; the model only classifies the intent.

## Acceptance criteria

- [ ] AC1: With a sent Booking Request, "add one more night" gives the request explanation and leaves the request unchanged.
- [ ] AC2: With an offer, the offer explanation; with a reservation, the amendment explanation.
- [ ] AC3 failure path: no search runs and no proposal is created on these turns.
- [ ] AC4: Same reply as the deterministic path (parity test), with a cold restore before every event.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0005 | A Booking Request is not a Reservation | AC1 copy |
| 0060 | Versioned amendments | AC2 |
| 0080 | Parity | AC4 |

## Comments

## Comments

### Implementation ADR table (agent, 2 Nov 2026)

Read in full: ADR 0106, 0099, 0077, 0080, 0005, 0060 (and 0075 for logging). 0092/0093 read for guest accounts and dates; no date rule changes here.

| ADR | Constraint | Code path / AC |
|---|---|---|
| 0005 | A sent Booking Request is not a Reservation; its copy says nothing has changed and names the only exit (no-cost decline, search again) | `GUEST_CHANGE_EXPLANATION.request` / `offer` (`guest-content.ts`), AC1 |
| 0060 | Stay facts change only through a versioned platform amendment; after a confirmed Reservation the copy points to the amendment, never a silent edit | `GUEST_CHANGE_EXPLANATION.booking`, AC2 |
| 0080 | Parity: the deterministic `#changeExplanation` and the assistant pack read the same copy, and the stage rule is the same (booking > payment > offer > request) | `shortlet-app.ts` `#changeExplanation`, `shortlet-assistant-pack.ts` `sentChangeStage`, AC4 |
| 0106 | Model classifies only. Closed intent `change` added to `CONCIERGE_INTENTS`; no keyword or regex shortcut. The pack answers from task state with no planner call and no tool, so no search or proposal can run (AC3). Date authority untouched | `scope-classifier.ts` (intent + one system sentence), `assistant-runtime.ts` (pack answer before the planner loop), AC1 to AC3 |
| 0106 | Ids held by the guest are re-keyed from persisted state on every cold restore; the stage is read from the restored task state, never re-minted | AC1, AC2 (cold restore before every event) |
| 0099 | Runtime is domain-neutral: a new optional pack hook `answerValidatedTurn` gets intents, slots and task state; the shortlet logic (stage, copy) lives in the pack | `assistant-platform.ts` (hook), `assistant-runtime.ts` (call), `shortlet-assistant-pack.ts` (implementation) |
| 0077 | Copy lives in `guest-content.ts`; chat and deterministic path read it from one object | `guest-content.ts` |
| 0075 | No guest text, id or provider text in logs or diagnostics. The new path adds no log line; outcome is the existing closed `successful_model_handling` | `assistant-runtime.ts` |
| 0074 | A proposal is never created on these turns; any open pending action is left as it is (no `supersede` call on this path) | AC3 |

Order of work (agent, 2 Nov 2026):

- Step 1, behaviour-preserving: the four strings moved to `GUEST_CHANGE_EXPLANATION` (`guest-content.ts`); `#changeExplanation` calls them. Wording byte-identical (checked against the old template literals). No import cycle: `guest-content.ts` imports nothing from the app.
- Step 2, red: `env -u LLM_API_KEY npx tsx --test test/assistant-change-explanations.test.ts`: 0 pass / 7 fail. Every AC fails because the `change` intent is not valid yet (the reply is the fixed unavailable sentence) and the planner is called on the change turn (AC3: planner 1, expected 0).
- Step 3, green: the same file 7 pass / 0 fail (after the pack and runtime change).
- Regression found and fixed: `test/helpers/assistant-scope.ts` (`approvedTestScope`) approves every intent. With `change` in the list, every planner test on a sent stay was answered by the explanation instead of the planner (`shortlet-assistant-evals.test.ts`: 7 fail, Eval 13 to 15, the offer and checkout revalidation tests, the two reconciliation tests). The helper now approves every intent except `change`, which has its own tests. This is the helper's stated purpose (isolate planner tests from the scope boundary), not a weakened test.

Commands and counts (after all changes):

- `env -u LLM_API_KEY npx tsx --test test/assistant-change-explanations.test.ts`: 7 pass / 7 total (AC1, AC2 offer, AC2 payment, AC2 reservation, AC3 failure path, AC4 parity over request/offer/payment/booking, discovery-stage change as an ordinary search).
- Per file, `env -u LLM_API_KEY npx tsx --test <file>` (pass / fail):
  - `test/assistant-scope-controls.test.ts` 38 / 0
  - `test/assistant-scope-persistence.test.ts` 2 / 0
  - `test/assistant-cold-journey.test.ts` 3 / 0
  - `test/assistant-booking-journey.test.ts` 8 / 0
  - `test/shortlet-assistant-evals.test.ts` 52 / 0
  - `test/assistant-reply-coverage.test.ts` 5 / 0
  - `test/assistant-reply-plan-references.test.ts` 9 / 0
  - `test/assistant-reply-control-outcome.test.ts` 2 / 0
  - `test/assistant-runtime-boundary.test.ts` 5 / 0
  - `test/assistant-unregistered-domain.test.ts` 8 / 0
  - `test/assistant-pack-registry.test.ts` 3 / 0
  - `test/assistant-recorded-journeys.test.ts` 5 / 5 (replay unchanged: replay compares tool names, structured-output name and history, not the classifier system text or intent enum)
  - `test/assistant-clarification-chips.test.ts` 4 / 0
  - `test/assistant-closed-lists.test.ts` 8 / 0
  - `test/assistant-control-metrics.test.ts` 6 / 0
  - `test/assistant-control-outcome-count.test.ts` 2 / 0
  - `test/assistant-tool-authorization.test.ts` 7 / 0 (its `fixedScope(CONCIERGE_INTENTS)` includes `change`; the search tools are still authorised through `search`)
  - `test/guest-criteria-strip.test.ts` 5 / 0 (deterministic change explanation on the criteria strip)
  - `test/guest-never-silent.test.ts` 3 / 0 (deterministic "Nothing has been changed" copy)
  - Copy and presentation touched by `guest-content.ts`: `test/guest-copy-pass.test.ts` 7 / 0, `test/guest-presentation-contract.test.ts` 9 / 0, `test/guest-kit.test.ts` 11 / 0, `test/guest-must-fix-ux.test.ts` 7 / 0, `test/guest-new-conversation.test.ts` 6 / 0, `test/guest-offer-access.test.ts` 11 / 0, `test/assistant-persistent-continuity.test.ts` 7 / 0, `test/assistant-request-summary.test.ts` 3 / 0, `test/guest-chip-continuity.test.ts` 6 / 0
  - Files that use `approvedTestScope`, run one by one after the helper change: `shortlet-assistant-evals` 52 / 0, `assistant-interactions-protocol` 15 / 0, `assistant-reply-control-outcome` 2 / 0, `assistant-reply-coverage` 5 / 0, `assistant-reply-plan-references` 9 / 0, `assistant-scope-persistence` 2 / 0, `assistant-shortlet-stage-behaviour` 3 / 0, `assistant-stage-handlers` 8 / 0, `assistant-unregistered-domain` 8 / 0, `commerce-agent-tools` 14 / 0, `conversation-router` 3 / 0 (sum 121 / 121). Before the helper change, `shortlet-assistant-evals` alone had 7 failures (see the regression note above).
  - Pilot smoke: `test/pilot-agent-smoke-metrics.test.ts` 9 / 0, `test/pilot-agent-smoke-report.test.ts` 8 / 0. (A combined multi-file run reported a total that did not match the per-file sums; the per-file counts above are the record.)
- `env -u LLM_API_KEY npm run check`: exit 0, zero `error TS` lines, worker bundle guard passes.
- Not run per Test scope: the full `npm test` and `npm run test:workers` (once per batch, before merging to main). No Worker code changed.

Definition of Done (`docs/agents/issue-tracker.md`):

1. Every AC has a dedicated named test: AC1 (`AC1: With a sent Booking Request...`), AC2 (three tests, one per stage: offer, accepted offer, reservation), AC3 (`AC3 failure path: ...`), AC4 (`AC4: Same reply as the deterministic path...`). Done.
2. Failure paths: AC3 asserts no planner call, no surface, unchanged discovery artifact, criteria and task state, and no pending action, on a turn where the classifier misreads the change as a search with the planner's search call scripted. AC1 asserts the request facts are unchanged. AC4 asserts the deterministic path explains (not a capability reply) before comparing. Done.
3. ADRs cited: the table above (0005, 0060, 0080, 0106, 0099, 0077, 0075, 0074), and at the call sites (`shortlet-assistant-pack.ts`, `assistant-runtime.ts`, `assistant-platform.ts`, `scope-classifier.ts`, `guest-content.ts`). Done.
4. No unused injected dependency: no new constructor parameter. The new pack hook gets `environment` through the existing pack factory and uses it. Done.
5. No invented policy: the copy is moved, not changed. The one new closed value is the intent `change` (see Answer, owner decision). No new numbers. Done with that one flagged addition.
6. No credential or guest value in logs: no log line added. The new path returns the existing closed `successful_model_handling` outcome. Done.
7. `npm run check` passes (exit 0). The full `npm test` is deferred to the batch pre-merge gate per Test scope, so this item is not satisfied for this commit until that gate runs. Stated plainly.

Design decisions and deviations (please review):

- Owner decision, closed list (ADR 0106): the intent `change` is added to `CONCIERGE_INTENTS`, with one sentence in the classifier system instruction. The schema enum and the validator follow the constant. The recorded journeys still replay 5/5. Owner can veto; if vetoed, AC1 to AC4 need another signal.
- Owner decision, pack seam (ADR 0099): one optional pack hook `answerValidatedTurn(intents, slots, taskState)`. The runtime calls it after the scope verdict and before any planner round. A reply from it means no planner call and no tool. I did not use a new reply-plan kind: a reply plan still lets the planner choose tools, so it could not guarantee AC3.
- Trigger (classifier only, no text read): the `change` intent, or a `search` verdict that carries a stay fact (nights, guests, checkIn or checkOut). Only when a Booking Request, offer, accepted offer or Reservation is in the restored task state. A `change` in discovery maps to `search_stays`, so it is an ordinary search there.
- Stage (from the server, not text): Reservation (`currentContractId` or `currentReservationId`) gives booking; `currentOfferId` gives payment when the offer's status is `accepted`, else offer; `currentBookingRequestId` gives request. The task state has no payment marker, so payment is read from the offer's status. A read failure is an error, so the turn fails closed (`CONCIERGE_UNAVAILABLE`).
- Outcome: a pack-answered turn reports `successful_model_handling`. No new outcome code. Owner may want a `change_explained` outcome for telemetry.
- Parity: AC4 covers request, offer, accepted offer (payment) and reservation. The deterministic payment stage after a cold restore is read from the same persisted offer status in the test; no deviation was seen.
- Not covered (known gap, unchanged): in a sent state, a `search` verdict with only a city or neighbourhood still goes to the planner and can run `search_stays`, as it does today. The deterministic path does not search in those stages. Owner to decide if that should also be answered.
- Test helper: `test/helpers/assistant-stage-journey.ts` (new: journeys to request, offer, payment and reservation, each event cold-restored). `approvedTestScope` excludes `change`. `assistant-booking-journey.test.ts` keeps its own `send`/`step` (not refactored here; a small remaining duplicate).
- Screenshots: none taken (no guest screen changed; this is copy and assistant behaviour).

## Answer

- `apps/web-agent/src/guest-content.ts`: `GUEST_CHANGE_EXPLANATION` (`request(operatorName)`, `offer()`, `payment()`, `booking()`), the four strings moved verbatim.
- `apps/local-guest/src/shortlet-app.ts`: `#changeExplanation` calls `GUEST_CHANGE_EXPLANATION`; behaviour unchanged.
- `apps/local-guest/src/assistant/scope-classifier.ts`: closed intent `change` added to `CONCIERGE_INTENTS` (the schema and validator follow it); one sentence in the classifier system instruction.
- `apps/local-guest/src/assistant/assistant-platform.ts`: optional pack hook `answerValidatedTurn`.
- `apps/local-guest/src/assistant/assistant-runtime.ts`: calls the hook inside the turn's try block, before the planner loop; a reply skips the planner and the summary call.
- `apps/local-guest/src/assistant/shortlet-assistant-pack.ts`: `asksToChangeStay`, `sentStageFor`, the `answerValidatedTurn` implementation, and `change: ["search_stays"]` in `toolIntentMap`.
- `test/assistant-change-explanations.test.ts` (new): AC1, AC2 (offer, payment, reservation), AC3 failure path, AC4 parity, and the discovery-stage control.
- `test/helpers/assistant-stage-journey.ts` (new): journeys to each sent stage with a cold restore before every event.
- `test/helpers/assistant-scope.ts`: `approvedTestScope` excludes `change`.
- Owner decisions to veto: the closed intent `change` (ADR 0106 list), the pack hook `answerValidatedTurn` (ADR 0099 seam), and the reuse of `successful_model_handling` as the outcome.
