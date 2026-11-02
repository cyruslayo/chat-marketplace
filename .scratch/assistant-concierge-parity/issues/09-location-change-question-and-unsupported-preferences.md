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
