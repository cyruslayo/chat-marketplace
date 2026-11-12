# The assistant remembers the question it asked (open-question state, ADR 0106 amendment)

Status: resolved
Type: AFK
Blocked by: 62
Blocks: 58, 59, 61
Requested: 9 Nov 2026 (owner decision: amend ADR 0106 to allow one closed open-question code)

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md). Batch: chat hardening, issues 56–62.

## Why

The assistant forgets what it just asked:

- **Classifier.** It receives `{ message, context: { domain, description, hasShortlist, hasSelectedStay, hasOffer } }` (`apps/local-guest/src/assistant/scope-classifier.ts:78-91`, built at `assistant-runtime.ts` ~1083). A terse answer such as "Just me", "2", "a week" or "the first one" carries no meaning without the question, so it comes back `unclear`. The guest then gets the fixed `ASSISTANT_CONTROL_COPY.unavailable` and their input is discarded (`assistant-runtime.ts` ~1101-1107). Staging, 9 Nov 2026: issue 56, defect 2.
- **Planner.** It never sees the question either. `#boundedHistory` (`assistant-runtime.ts` ~459-464) drops assistant steps, which are stored as "Server reply delivered." (~1005), and model history is not persisted across Worker requests.
- **Task state.** It has only two narrow open questions, `stayIntent.pendingDate` and `stayIntent.pendingLocation` (`assistant-state.ts:42-66`). Nothing records "I asked for the party size". `AssistantClarificationKind` (`assistant-platform.ts:99`) only picks chip sets and is never stored.

The fix gives both models one closed, server-set code that names the open question. No assistant text or history is added, so ADR 0075's minimisation and ADR 0106's closed-code rules hold.

## What to build

1. **ADR 0106 amendment** (a dated section, 9 Nov 2026, owner-approved). The classifier's minimal task summary and the planner's canonical task facts may carry one closed `openQuestion` code. The value set is `where | party_size | check_in | nights | stay_length | pick_result | date_confirm | location_confirm`. The code is server-set only, never derived from model output, and never carries text. A code outside the set is dropped. It grants no permission: a fact still needs guest text, a chip or a confirmed show-back (date authority is unchanged). The amendment repeats that no keyword fast path is allowed.
2. **State.** Add `openQuestion?: OpenQuestion` to `AssistantTaskState` (`assistant-state.ts:79-97`), with the closed type and a guard.
3. **Set it, through one runtime method.** Add `recordOpenQuestion(threadId, code | null)` on the runtime, beside `recordGuestStay` (`assistant-runtime.ts:774`). Derive the code from `stayCriteriaGap` (`apps/local-guest/src/concierge.ts:163`) for stay clarifications, and from `pendingDate` / `pendingLocation` for show-backs. Call it from:
   - planner `clarify_stay` replies and `replyClarificationKind` (`assistant-runtime.ts` ~1211, ~1417; `quickRepliesForReply` ~1850);
   - `tool_denial` clarifications (`assistant-runtime.ts` ~1481, chip kind `stay_details` / `dates` / `area`);
   - the shell's clarify branches: `#handleCriteriaEdit` (`shortlet-app.ts` ~4055, the "So far I have…" reply) and the typed-turn clarify (~976);
   - `#viewResultFromChat`'s askWhich (`pick_result`).
4. **Clear it** when a turn commits new task state, when a turn asks a different question (overwrite), and on a new search.
5. **Persist it.** Add it to `PersistedAssistantContext`, `#assistantContextFromState`, `#restoreAssistantFromGuestThread` (`shortlet-app.ts` ~3272) and the projection validation in `guest-projection.ts`, so it survives a cold restore. An invalid persisted value is dropped (fail closed).
6. **Classifier.** Add `openQuestion` to `ScopeContext` (`scope-classifier.ts:12-20`) and to the context at `assistant-runtime.ts` ~1083. Add one sentence to the system instruction: "If context.openQuestion is set, a short reply that answers it is in scope; fill only that slot." The retry sends the identical request, as before.
7. **Planner.** Include `openQuestion` in the `Canonical task facts` line (`#boundedHistory`). Add one sentence to `SHORTLET_PROMPT_SECTION` on reading it. Keep the instruction stable per pack (agent-modes issue 02).

## ADRs

| ADR | Constraint | Where |
|---|---|---|
| 0106 | Classifier input is the current message plus a minimal server-built summary, with closed codes only and failures fail closed. No deterministic in-scope fast path. Date authority unchanged. | Amendment; steps 3–7 |
| 0075 | Minimise agent data. No assistant prose and no identifiers in the classifier request. | Closed code only |
| 0092 / 0093 | Dates and guest accounts. Staging-like guest and clock in tests. | Tests |
| 0107 D11 | Lanes: a pack's models see only their own lane. The code belongs to the active task. | Stored on the task's state |

## Acceptance criteria

New `test/assistant-open-question.test.ts`: assistant on, cold restore (a new `LocalGuestApp` over the same store) before every event, fresh thread, 2026-10-27 clock, staging guest with no phone or email. Run warm and cold.

- [x] After a When chip that only asks for guests, the next classifier request carries `openQuestion: "party_size"`.
- [x] After a planner `clarify_stay`, the classifier request carries the code for the next missing criterion.
- [x] After a `tool_denial` for a missing party size or nights, the code is `party_size` or `nights`.
- [x] After an askWhich with several results, the code is `pick_result`. After a date show-back, it is `date_confirm`. After a location show-back, it is `location_confirm`.
- [x] Once the question is answered (state committed), the next classifier request carries no code.
- [x] The code survives a cold restore.
- [x] A persisted unknown code (e.g. `"drop_tables"`) is dropped on restore, and the classifier request carries none.
- [x] The planner request's canonical-facts line carries the code, and its history still contains no assistant prose.
- [x] `test/assistant-cold-journey.test.ts` and the scope-control tests still pass.

## Verification

`env -u LLM_API_KEY npm run check`. Then `env -u LLM_API_KEY npx tsx --test test/assistant-open-question.test.ts test/assistant-cold-journey.test.ts test/assistant-scope-controls.test.ts test/assistant-clarification-chips.test.ts test/assistant-date-phrases.test.ts test/assistant-location-change.test.ts test/assistant-discovery-artifact-drift.test.ts`. Record the counts in Comments.

## Comments
- 9 Nov 2026, implemented on `fix/chat-hardening`. Commands (all with `env -u LLM_API_KEY`):
  - `npm run check`: clean (tsc x4 plus the worker bundle guard).
  - `npx tsx --test test/assistant-open-question.test.ts`: 17 of 17 pass (warm and cold).
  - `npx tsx --test test/assistant-open-question.test.ts test/assistant-cold-journey.test.ts test/assistant-scope-controls.test.ts test/assistant-clarification-chips.test.ts test/assistant-date-phrases.test.ts test/assistant-location-change.test.ts test/assistant-discovery-artifact-drift.test.ts`: 87 of 87 pass.
- ADRs read and applied: 0106 (amended 9 Nov 2026 with the closed open-question code; closed codes only, no new model data, no keyword fast path, date authority unchanged), 0075 (closed code only, no assistant prose in either request), 0092/0093 (staging clock 2026-10-27 and staging guest in every test), 0107 D11 (the code lives on the active task's state).
- Implementation: `OpenQuestion`/`isOpenQuestion` and the task-state field in `assistant-state.ts`; `clarificationOpenQuestion` hook on the pack, `openQuestionForCriteria`/`openQuestionForCriterion` in `shortlet-assistant-pack.ts`; `recordOpenQuestion` + set/clear on the reply and tool-denial paths, the classifier context, and the canonical-facts line in `assistant-runtime.ts`; `openQuestion` on `ScopeContext` and the classifier instruction; shell persistence in `#assistantContextFromState`/`#restoreAssistantFromGuestThread` and set/clear in `#handleCriteriaEdit`, the typed-turn clarify and `#viewResultFromChat`'s askWhich; `PersistedAssistantContext.openQuestion` with a fail-closed drop in `guest-projection.ts`.
- Definition of Done: every acceptance criterion has a named test (AC8 is the "canonical-facts line carries the code, no assistant prose" test; AC for "nights" is `openQuestionForCriteria names nights…`); ADRs listed above; no new injected dependency; no invented policy string (the code set is the issue's closed list); no credential or identity material added; check and the tests above are green.

- 9 Nov 2026, pre-merge gate fixes (`gate/chat-hardening`, HEAD 74a18e5 with main merged). Commands (all with `env -u LLM_API_KEY`, `NODE_ENV=test`): `npm run check` clean; the 12-file gate list 122 of 122 pass.
- Item 2: `assistant-runtime.ts` imported `GUEST_ASSISTANT_COPY` from web-agent. Added the pack hook `openQuestionCopy(code)` (implemented in `shortlet-assistant-pack.ts` from `GUEST_ASSISTANT_COPY`) and the runtime now uses it, so the runtime imports nothing from `domains/shortlet` or `web-agent` (assistant-pack-registry AC1).
- Item 3: the recordings were legitimately stale. The 9 Nov amendment adds `openQuestion` to the planner's canonical facts (and the issue 20 guest-authored area now persists), which changes step 2's request history. Re-recorded all five journeys offline with the repo's own tool, `scripts/record-assistant-journey.ts` (scripted model, no provider), and removed the obsolete in-memory `withOwnerAreaFact` patch; replay reproduces every turn.
- Item 4: per the 9 Nov lifecycle ("the code is overwritten when a turn asks a different question"), a clarification records the open question it asks. The tool_denial dated clarification records `check_in`, and the malformed start_task's follow-up area clarification records `where`; both assertions now allow exactly that key (and assert its value) while all other state stays equal.
