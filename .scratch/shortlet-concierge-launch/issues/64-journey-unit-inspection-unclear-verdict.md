# The journey unit-inspection turn is intermittently refused as unclear

Status: needs-triage
Type: task
Blocked by: none
Requested: 16 Nov 2026

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md). Found while gating issue 63; see that issue's Comments for the full run records.

## Why

Closed evidence from the measured runs of `npm run pilot:local:agent-smoke -- --request-limit 16 --runs 3` on `openai/gpt-6-luna` (ADR 0075: closed codes only, no model or guest text):

- 16 Nov 2026 12:15 UTC (`6385c99`): journey run 2 unit inspection, outcome `scope_unavailable` (the run's only journey false refusal), so no unit was selected; run 2 unit inspection and booking intent `MODEL_SELECTION_FAILURE`; completed tasks 10 of 12.
- 16 Nov 2026 13:39 UTC (`6385c99`): journey run 3 unit inspection, the same shape and the same two `MODEL_SELECTION_FAILURE` rows; completed tasks 10 of 12 (runs 1 and 2 passed all four turns).
- The 09:46 and 11:35 runs on earlier commits, and every other journey turn in every run: 0 journey false refusals.

The unit-inspection turn's pick-style message was read `unclear` 2 times out of 6 journey attempts on this model, and no other journey turn has ever flaked. A false refusal on that turn stops the journey: no unit is selected, so the booking turn cannot run, and the smoke reports FAIL.

The unit-inspection turn asks the classifier to read a positional pick against results the server shows, with no `openQuestion` code set (the assistant did not ask which result). The classifier instruction's positional-pick rule is conditioned on `context.openQuestion is pick_result`; on this turn the model must rely on the general acceptance of terse contextual follow-ups.

## What to build

To be decided at triage. Candidates: a general positional-pick rule in the classifier instruction that does not depend on the open-question code (the instruction states general rules only, quotes no eval text, and adds no fast path, ADR 0106), or accepting the measured rate. Any change rides the existing smoke for its live criterion and must keep the terse eval's instruction tests passing.

## ADRs

| ADR | Constraint | Where |
|---|---|---|
| 0106 | The classifier verdict is advisory; no deterministic in-scope fast path; instruction rules are general and quote no eval text. | What to build |
| 0075 | Diagnostics and reports carry closed codes and counts only. | Why |

## Comments

- 16 Nov 2026: filed from issue 63's gating evidence. No diagnosis beyond the closed codes above; the two verdicts themselves are not recorded (ADR 0075).
