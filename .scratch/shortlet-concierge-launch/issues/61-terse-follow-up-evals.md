# Evals for terse follow-ups (offline cases plus owner-run live cases)

Status: ready-for-agent
Type: AFK (the live run is owner-run)
Blocked by: 57, 58, 59
Requested: 9 Nov 2026

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md). Batch: chat hardening, issues 56–62.

## Why

Every offline test scripts the classifier verdict (`scriptedPlanner` in `test/helpers/guest-date-fixtures.ts`), so none of them catches a live model reading "Just me" as `unclear`. ADR 0106 (L68) asks for false refusals to be measured separately. After issue 57 the classifier and planner receive the open question. These cases pin the offline wiring, and they give the owner a live check of the false-refusal rate.

## What to build

1. **Offline.** Add `test/assistant-terse-followups.test.ts`: assistant on, cold restore before every event, 2026-10-27 clock, staging guest. For each case, set up the open question, send the text, and assert two things:
   - the classifier request carries the expected `openQuestion`;
   - with a scripted in-scope verdict carrying the slot, the fact is committed and the next step follows (a search, a detail, or a confirmed date).

   | Open question | Guest text | Expected fact |
   |---|---|---|
   | party_size | "just me" / "2" / "two of us" / "me and my wife" | partySize 1 / 2 / 2 / 2 |
   | nights | "a week" / "3" | nights 7 / 3 |
   | pick_result | "the first one" / "the second" | opens result 1 / 2 |
   | date_confirm | "yes" | check-in confirmed |
   | where | "Wuse 2" | Abuja, Wuse 2 |

2. **Live.** Add the same cases to the existing live eval (`scripts/pilot-agent-smoke.ts`, with its report in `scripts/pilot-agent-smoke-report.ts`). Report the per-case verdict and the false-refusal rate as closed codes only, with no model text (ADR 0075). Agents write the cases and must never run the live eval: it needs `LLM_API_KEY`. The owner runs it and records the result here.
3. Add the cases to `docs/testing/shortlet-assistant-v1.md`.

## ADRs

| ADR | Constraint | Where |
|---|---|---|
| 0106 | False refusals are evaluated separately. Diagnostics use closed codes. No fast path. | Steps 1–2 |
| 0075 | No model text in reports. | Step 2 |

## Acceptance criteria

- [ ] Each offline case asserts the open-question code on the classifier request and the committed fact.
- [ ] A case with an `unclear` verdict falls back to the issue 59 re-ask, not to `unavailable`.
- [ ] The live eval lists the cases and reports a false-refusal rate. It is checked offline only with a fake model client.
- [ ] Owner: the live run is recorded in Comments with its rate. Target: no false refusals across the cases on `openai/gpt-6-luna`.

## Verification

`npm run check`; `env -u LLM_API_KEY npx tsx --test test/assistant-terse-followups.test.ts test/assistant-open-question.test.ts`. Record the counts in Comments.

## Comments
