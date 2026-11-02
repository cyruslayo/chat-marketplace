# Assistant: ask before switching location, and acknowledge unfilterable wishes

Status: resolved
Type: AFK
Blocked by: 08
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

- The deterministic path keeps `pendingLocationChange` and asks before replacing the area when a message names a different place (`mergeStayRequestContext`, `shortlet-app.ts:1038`). The assistant has no such step; a passing mention of another area can replace the search.
- The deterministic path adds `unsupportedPreferenceNote` to every reply when the guest asks for something discovery cannot filter by (issue 02 AC3, `shortlet-app.ts:1033`). The assistant says nothing.

## What to build

- A reply-plan field or pack projection for "location change pending" that renders the same question text as `merged.conflict.question`; no search until the guest answers. The answer is structured (chips) or guest text naming one of the two areas.
- The pack computes unsupported preferences from guest text with the shared helper and appends the same note.

## Acceptance criteria

- [ ] AC1: With a Lagos (Old Ikoyi) search active, "my friend lives in Abuja, is it far?" asks the change question and keeps the Ikoyi results.
- [ ] AC2: Answering the question with Abuja searches Abuja and keeps the other criteria.
- [ ] AC3 failure path: an unrelated reply leaves the search unchanged.
- [ ] AC4: "with a gym" adds the same note as the deterministic path, and the search runs without a gym filter.
- [ ] AC5: Runs with a cold restore before every event; the pending question survives a restore.
- [ ] AC6: A same-city neighbourhood change (Old Ikoyi to Lekki Phase 1) switches at once and asks nothing, as the deterministic path does.
- [ ] AC7: In a sent stay a location change gets the change explanation and no search runs.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0080 | Parity | AC1, AC4 |
| 0077 | Same copy from one module | AC4 |
| 0106 | Classifier location corrections stay validated | AC2 |
| 0060 | Stay facts change only through a versioned platform amendment; in a sent stay a location change gets the explanation (copy in `GUEST_CHANGE_EXPLANATION`), never a search or the question | AC7 |
| 12 (issue) | Hook `answerValidatedTurn` answers a sent-stay change from task state; the search-beside-other-intents guard (`assistant-context-isolation` AC4) must stay green | AC7, regression |

## Comments

### Triage note (agent, 2 Nov 2026)

Blockers: 08 is resolved (commit 1d6fc34, closed by f604178). No open blocker.

What the code does today and where it overlaps:
- Issue 08's area resolver (`resolveSearchNeighbourhood`, `shortlet-assistant-pack.ts:287`) accepts any neighbourhood in the searched city. A same-city change (Ikoyi to Lekki) therefore goes straight to `search_stays` with no question. That is the AC1 defect.
- For a different city, 08 refuses the word with the area clarification. The deterministic path asks the conflict question instead (08 Answer). AC1 does not say which rule applies to a cross-city word.
- The assistant task state (`assistant-state.ts`, `stayIntent`) has no `pendingLocationChange` field. The deterministic path keeps one in `DiscoverySearchContext` (`concierge.ts:85`). AC5 (the pending question survives a restore) needs a new state field, and the ADR 0093 minimal projection should be checked for it.
- `unsupportedPreferenceNote` (`concierge.ts:486`) is exported and already used on the deterministic path (`shortlet-app.ts:967`). The pack can call it directly.
- Conflict with 08 for AC4: 08 sends unknown amenity words to the closed enum, so when the planner sends "gym" the call is rejected as `invalid_arguments` (`MODEL_SELECTION_FAILURE`). AC4 requires the search to run without a gym filter. The pack must strip the unsupported preference before the schema check, using the same detection. The issue does not describe this step.
- Sent stays: 12 left open a bare city or neighbourhood search in a sent stay, which still reaches the planner and can run `search_stays` (commit a63f498, Comments and Answer). AC1 and AC2 cover only a search in progress. The issue should say what a location change does once a request is sent: the change explanation (ADR 0060) or the question.

Decisions needed from the owner before ready-for-agent:
1. Cross-city words: refuse (as 08 does) or ask the conflict question (as the deterministic path does).
2. A location change in a sent stay: explanation, question, or unchanged.
3. Gym: whether a gym question belongs to 11 (a facility answer) or to this issue (an unsupported-preference note). See the note on issue 11.

Recommended next status: `needs-info` until decisions 1 to 3 are answered, then `ready-for-agent`.

### Owner decisions (2 Nov 2026, approved; recorded by the implementing agent)

1. A word naming ANOTHER CITY asks the conflict question (the deterministic wording), instead of 08's area refusal.
2. A location change in a SENT stay (request, offer, payment, booking) gets the issue 12 change explanation (ADR 0060), not a search and not the question. This closes the gap 12 left open: a `search` verdict carrying only a place word in a sent stay no longer reaches the planner.
3. Unsupported search wishes ("with a gym", kitchen, balcony: catalogue-less amenities) belong to this issue: the reply carries the deterministic note (`unsupportedPreferenceNote`) and the search runs without the filter. A question about one apartment's facilities ("is there parking?") belongs to issue 11.

Status moved from `needs-triage` to `ready-for-agent` on the owner's approval, then `claimed`. ACs 6 and 7 were added for decisions 1 and 2.

### Implementation ADR table (agent, 2 Nov 2026)

Read in full: ADR 0106 (all amendments), 0099, 0080, 0077, 0075, 0093, 0060, and 0005 (the sent-stay copy). 0092 read for the horizon.

| ADR | Constraint | Code path / AC |
|---|---|---|
| 0099 | Runtime stays domain-neutral: new optional pack hooks only (`replyClarificationKind`, `requestedArguments` on the tool context); conflict, stage and copy rules live in `shortlet-assistant-pack.ts` | `assistant-platform.ts`, `assistant-runtime.ts`, pack - AC1 to AC4 |
| 0106 | Model proposes only the area words; the server decides. A planner area that differs from the held search raises a pending question and runs no search. Pending area is accepted only when the planner's closed area equals it | `executeAssistantTool` `search_stays` - AC1, AC2, AC3, AC6 |
| 0106 | Rejected tool calls commit no state, so the question is a successful non-search tool result (state is committed), not a `tool_denial` | `executeAssistantTool` - AC5 |
| 0106 | Unsupported words come from the closed alias table, never a regex over guest text in the pack; the amenity filter stays a closed id | `stay-vocabulary.ts` (`unsupportedAmenityLabelFor`), AC4 |
| 0106 | Persisted pending location is a field of the existing context (ADR 0093 minimal projection): closed validation, an invalid value is dropped (fail closed) | `guest-projection.ts` `parseAssistantContext`, `shortlet-app.ts` projection and restore - AC5 |
| 0060 / 0005 / 0080 | In a sent stay a `search` verdict with a city or neighbourhood slot is answered by `GUEST_CHANGE_EXPLANATION` from state; `intents.length === 1` keeps issue 12's guard | `asksToChangeStay` - AC7 |
| 0080 | Same question and same note as the deterministic path: the builder and the note are the existing functions, copy moved to `guest-content.ts` | `concierge.ts` `locationConflictQuestion`, `unsupportedPreferenceNote` - AC1, AC4, AC6 |
| 0077 | Copy in one module (`guest-content.ts`) | copy location |
| 0075 | No guest text, id or value in logs or diagnostics | no logging added |
| 0078 | Chips are the existing area labels, 44px via the existing `.ui-chip` | chips |

### Deviations found while reading the code (agent, 2 Nov 2026)

- The deterministic path does NOT ask about a same-city change. `mergeStayRequestContext` raises the conflict only when `establishedCity !== supplied.city`; Lekki after Ikoyi (both Lagos) silently replaces the neighbourhood (`concierge.ts` ~line 473, `applyLocation`). The triage note said otherwise. AC1 is owner-approved and asks the question, so the assistant asks it for a different neighbourhood in the same city. The deterministic path is left unchanged (its tests pin the cross-city case only). Owner to decide whether the deterministic path should ask for same-city changes too.
- The question text is the same builder (`locationConflictQuestion`). The assistant has no guest-typed label (it reads only closed-list areas, no regex over guest text), so its label is the canonical area name ("Lekki Phase 1 in Lagos"), where the deterministic path shows the guest's words ("Lekki in Lagos"). Same wording, canonical name.
- The unsupported note is the deterministic note text; the assistant reply carries it appended to the same reply (one string on this path, not a second message).

### Run record and blocker (agent, 2 Nov 2026): stopped for an owner decision

Implemented (uncommitted, working tree): `apps/local-guest/src/assistant/shortlet-assistant-pack.ts` (search area decision, pending question, chips, unsupported note, sent-stay guard), `assistant-runtime.ts` and `assistant-platform.ts` (hooks `replyClarificationKind`, `requestedArguments`, kind `location`), `assistant-state.ts` (`pendingLocation`), `shortlet-stage-handlers.ts` (no discovery surface change for a held question), `guest-projection.ts` and `shortlet-app.ts` (persisted field, closed parse, restore), `concierge.ts` and `stay-vocabulary.ts` (shared builder and unsupported labels), `guest-content.ts` (`GUEST_LOCATION_CONFLICT`), and the new `test/assistant-location-change.test.ts`.

Commands and counts:

- Red first: `env -u LLM_API_KEY npx tsx --test test/assistant-location-change.test.ts`: file fails to load (`locationConflictQuestion` not exported). Expected red.
- Green: `env -u LLM_API_KEY npx tsx --test test/assistant-location-change.test.ts`: 7 pass / 0 fail / 7 total (AC1 to AC7).
- Types: `env -u LLM_API_KEY npm run check`: exit 0, worker bundle guard passes.
- Affected set, one run (`env -u LLM_API_KEY npx tsx --test` over 25 files: the owner's list of assistant files, plus conversational-discovery, guest-budget, guest-reflective-replies, assistant-discovery-view, assistant-pending-action-restore, assistant-short-stays-29-nights, and the new file): 249 tests, 246 pass, 3 fail.
- Projection files, one run: assistant-discovery-view and assistant-persistent-continuity: 11 / 0.
- Not run: browser files (issue does not change a screen), `pilot-local` (contains a real-browser test), full `npm test` and `npm run test:workers` (pre-merge gate only).

The 3 failures are the same conflict, not a defect in the new code:

1. `test/assistant-recorded-journeys.test.ts` "The four named journeys...": the committed recording `search-refinement-request-draft` (Old Ikoyi search, then a refinement to Lekki Phase 1, same city) replays a planner search at step 6. The new rule asks the question instead.
2. `test/assistant-scope-controls.test.ts` "Scope AC2: valid stays, ... reach planning" (correction case): "Ignore Ikoyi. Change the location to Lekki Phase 1 in Lagos. Keep 4 nights and 2 guests." expects a refreshed discovery surface; the new rule returns the question and no surface.
3. `test/shortlet-assistant-evals.test.ts` "Eval 5: Search refinement updates destination and results": "Actually Lekki." after an Ikoyi search now asks instead of searching.

Why this is an owner decision, not a fix: AC1 (owner-approved) asks the question for a different neighbourhood in the same city. The three pinned tests are explicit location changes, and the deterministic path switches on them (`CORRECTION_PATTERN` in `concierge.ts`, "actually"). On the assistant path nothing in the closed vocabulary tells "is Ikoyi far from Lekki?" (a question) from "change it to Lekki" (an instruction), and a keyword shortcut is forbidden. So the assistant cannot keep both behaviours.

Options for the owner (agent recommends C):

- A. Accept that every same-city change asks. Update the recorded journey `search-refinement-request-draft` (re-record), Eval 5 and the scope-controls correction case. Deterministic path unchanged, so parity on same-city changes is broken until it is decided there too.
- B. Keep the explicit change switching at once (existing tests, deterministic parity). Then AC1 must be narrowed to cross-city changes, and AC1 itself must be revised.
- C. Let the classifier, not the text, separate the two: an explicit instruction to change the area is the closed `change` intent (today reserved for sent stays), and a place mention stays `search`. The server still decides, and `change` in discovery runs the search. This needs an ADR 0106 amendment to the classifier instruction, and the scripted tests (which name intents) need updating. Not verified against the live model.

Nothing is committed and no other issue was touched. The three pinned tests were not edited. Status set to `needs-info` pending the owner's choice. The DoD checklist and the commit wait for that decision.

### Owner decision (2 Nov 2026): option B, and the corrected triage fact (coordinator message)

- The change question is asked ONLY when the new area is in a DIFFERENT CITY, matching `mergeStayRequestContext`. A same-city neighbourhood change (Old Ikoyi to Lekki Phase 1) switches at once.
- The three tests that pin same-city switching pass UNCHANGED: the recorded journey `search-refinement-request-draft`, the scope-controls correction case, and Eval 5. No recording was edited.
- Corrected triage fact: the deterministic path asks only for a different city. `mergeStayRequestContext` raises the conflict when `establishedCity !== supplied.city`; a same-city neighbourhood change applies silently (`applyLocation`). The earlier note in this file, that the deterministic path asks before any different place, was wrong.
- ACs revised to match: AC1 is the Abuja example (merged with the old cross-city AC6); AC2 answers with Abuja; AC6 is the same-city switch with no question.

### Resolution (agent, 2 Nov 2026)

Commands and counts (after the owner decision):

- Red then green, the new same-city test: before the pack change, `env -u LLM_API_KEY npx tsx --test test/assistant-location-change.test.ts` gave 6 pass / 1 fail (AC6 failed: the same-city change asked the question). After the change: 7 pass / 0 fail / 7 total (AC1 to AC7).
- `env -u LLM_API_KEY npm run check`: exit 0, worker bundle guard passes.
- Affected set, one run, 25 files (the owner's assistant list, plus conversational-discovery, guest-budget, guest-reflective-replies, assistant-discovery-view, assistant-pending-action-restore, assistant-short-stays-29-nights, and assistant-location-change): 249 tests, 249 pass, 0 fail. This includes the three formerly failing files: assistant-recorded-journeys (5/5), assistant-scope-controls (AC2 correction case), shortlet-assistant-evals (Eval 5).
- `test/assistant-context-isolation.test.ts`: 7 pass / 0 fail / 7 total (AC4 guard holds).
- Not run: the real-browser files (no screen changed), `pilot-local` (contains a real-browser test), full `npm test` and `npm run test:workers` (pre-merge gate only).

Definition of Done (`docs/agents/issue-tracker.md`):

1. Every AC has a dedicated test named after it: `test/assistant-location-change.test.ts`, AC1 to AC7.
2. Failure paths: AC3 (unrelated reply leaves the search unchanged), AC7 (sent stay runs no search), AC1 (different-city question keeps results). Done.
3. ADRs cited: 0060, 0005, 0080, 0099, 0106, 0093, 0077, 0075, 0078 (table above; code comments at the pack and the projection).
4. No unused injected dependency: no new constructor parameter. The new pack hook `replyClarificationKind` is called by the runtime at both reply sites.
5. No invented policy: copy is in `GUEST_LOCATION_CONFLICT` and the existing change copy; the chips are the closed area labels; the unsupported note is the deterministic `unsupportedPreferenceNote`.
6. No guest text or values in logs: no logging added. The unsupported labels come from the closed alias table, never a regex over guest text.
7. `npm run check` passes. The full `npm test` is deferred to the batch pre-merge gate per Test scope.

Deviations, stated plainly:

- The assistant labels the new area with its canonical area name ("Abuja (all areas)" chip, "Abuja" in the question). The deterministic path shows the guest's own words, because the assistant reads no guest text.
- The unsupported-preference note is appended to the reply as one string. The deterministic path sends it as a separate message.
- A pending change is kept after a same-city search and cleared only when its own area is answered. Owner to confirm if a same-city switch should also clear it.

## Answer

- `apps/local-guest/src/assistant/shortlet-assistant-pack.ts`: `executeAssistantTool` `search_stays` holds a different-city change as `pendingLocation` (no search); a same-city change searches at once; the pending area is accepted when the planner names it. Also the change-question renderer, chips for the `location` kind, the unsupported note on replies, and `asksToChangeStay` with place slots.
- `apps/local-guest/src/assistant/assistant-runtime.ts`, `assistant-platform.ts`: optional hooks `replyClarificationKind` and `requestedArguments`; chips from `quickRepliesForReply`.
- `apps/local-guest/src/assistant/assistant-state.ts`: `AssistantPendingLocation`, `stayIntent.pendingLocation`.
- `apps/local-guest/src/assistant/shortlet-stage-handlers.ts`: a held change keeps the current results and surface.
- `apps/local-guest/src/guest-projection.ts`, `apps/local-guest/src/shortlet-app.ts`: the pending field in the existing context, closed parse (invalid values dropped), persisted and restored.
- `apps/local-guest/src/concierge.ts`, `apps/local-guest/src/stay-vocabulary.ts`: exported `locationConflictQuestion`; `unsupportedAmenityLabelFor`, with the labels gym, kitchen and balcony.
- `apps/web-agent/src/guest-content.ts`: `GUEST_LOCATION_CONFLICT`.
- `test/assistant-location-change.test.ts` (new).


- Owner decision (2 Nov 2026): keep the pending location question after a same-city switch (current behaviour).
