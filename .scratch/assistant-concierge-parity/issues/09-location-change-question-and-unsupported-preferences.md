# Assistant: ask before switching location, and acknowledge unfilterable wishes

Status: needs-triage
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

- [ ] AC1: With an Ikoyi search active, "my friend lives in Lekki, is Ikoyi far?" asks the change question and keeps the Ikoyi results.
- [ ] AC2: Answering the question with Lekki searches Lekki and keeps the other criteria.
- [ ] AC3 failure path: an unrelated reply leaves the search unchanged.
- [ ] AC4: "with a gym" adds the same note as the deterministic path, and the search runs without a gym filter.
- [ ] AC5: Runs with a cold restore before every event; the pending question survives a restore.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0080 | Parity | AC1, AC4 |
| 0077 | Same copy from one module | AC4 |
| 0106 | Classifier location corrections stay validated | AC2 |

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
