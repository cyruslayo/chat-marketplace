# One parity suite that runs the same guest text through both concierges

Status: needs-triage
Type: AFK
Blocked by: 04, 05, 07, 08, 09, 11, 12, 13
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

ADR 0080 requires deterministic parity, but no test compares the two paths. The deterministic tests (`guest-real-dates`, `guest-draft-revision`, `guest-must-fix-ux`, `guest-discovery-reasons-chromium`) never enable the assistant. Two behaviours were not checked in this review and need a test: "show me the last one" opening a result (`viewResultIntent`, issue 10 C4), and an unrelated turn keeping the current results (`shortlet-app.ts:1081`).

## What to build

- A shared fixture (in `test/helpers/`) that runs a table of guest turns through a non-assistant app and an assistant app (scripted model, cold restore before every event, clock 2026-10-27, no seeded contact), and compares the resulting filters, surfaces and reply kinds.
- Rows for every issue in this effort, plus the two unchecked behaviours above.
- A separate, owner-run live script that repeats each row k = 5 times against the staging model and reports pass^k from the closed `assistant.control.outcome.v1` outcomes. It is not part of `npm test`.

## Acceptance criteria

- [ ] AC1: Every row gives the same filters and surface kinds on both paths.
- [ ] AC2: "show me the last one" opens the last result on both paths.
- [ ] AC3 failure path: an unrelated turn keeps the current results on both paths.
- [ ] AC4: The live script prints pass^k per row and logs no guest text (ADR 0075).
- [ ] AC5: The fixture is shared, not copied between test files (AGENTS.md anti-pattern 4).

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0080 | Deterministic parity | AC1 to AC3 |
| 0106 | Cold restore and staging-like setup | Fixture |
| 0075 | No guest text in logs | AC4 |

## Comments

### Triage note (agent, 2 Nov 2026)

Blockers: 04, 05, 07, 09, 11 and 13 are still `needs-triage`, and their own blockers (01 and 02) are open. 08 and 12 are resolved (map.md lists 12 as resolved). Six of eight blockers are open, so this issue cannot start.

Notes for when it is unblocked:
- Helpers exist and must be reused, not copied (AC5): `test/helpers/assistant-stage-journey.ts` (journeys to each sent stage, with a cold restore before every event), `test/helpers/guest-date-fixtures.ts` (`coldTurn`, `reply`, `scope`), `test/helpers/assistant-scope.ts` (`approvedTestScope`, which excludes `change`) and `test/helpers/assistant-turn-model.ts`.
- Clock mismatch: the deterministic tests use the Thursday 3 Sept 2026 fixture (`test/guest-real-dates.test.ts`). AGENTS.md requires 2026-10-27 for assistant tests. One clock must serve both paths, so the expected values in existing tests (for example "Fri 4 Sept 2026") need re-basing. The fixture AC should say so.
- AC2 ("show me the last one") has no assistant route. `viewResultIntent` (`concierge.ts:813`) is deterministic only and is tested in `test/guest-must-fix-ux.test.ts:63`. On the assistant path the planner decides (research section 6, row 8, not verified). The row will fail today. The owner must decide whether this is a pack hook or a planner tool.
- AC3 (unrelated turn keeps the results): the deterministic guard is `shortlet-app.ts:1081`. On the assistant path the risk is a `search` verdict with only a place word reaching `search_stays`, the gap issue 12 left open. That row fails on a sent stay until the gap is decided.
- The issue has no row table yet. Build it from the ACs of 04, 05, 07, 09, 11, 12 and 13. Each row names the filters and surface kind expected on both paths.
- AC4 live script: an owner-run paid evaluation, so it needs explicit owner approval, the 1500 daily model-call cap (AGENTS.md), and the 2026-10-27 clock. Keep it out of `npm test`.
- "Blocked by" lists 12, which is resolved. Keep it for the record or remove it.

Recommended next status: keep `needs-triage`. Re-triage after 04, 05, 07, 09, 11 and 13 are resolved.

#### Update (agent, 2 Nov 2026, after 07, 09 and 12 were resolved)

The blocker line above is out of date. Its direct blockers now stand as follows.

- Resolved: 07 (budget from guest words, commit 4723876), 08 (closed lists, commit 1d6fc34), 09 (location question, commit bc69a2b) and 12 (explanations after submission, commits a63f498 and b576455).
- Still open (all `needs-triage`): 04, 05, 11 and 13. Their triage notes are in their own Comments.
- 01, 02 and 03 are resolved, but they are blockers of 04 and 05, not of 16. 06 resolves a blocker of 07. 10 is resolved, but it is not a blocker of 16. Its chips are used by 04 and 11.

Still `needs-triage`. The earlier line "04, 05, 07, 09, 11 and 13 are still needs-triage" is superseded by this update: 07 and 09 are resolved.

Clock consequence: on the staging clock (Tue 27 Oct 2026), "next Friday" is ambiguous (30 Oct and 6 Nov), not a day. Every parity row that uses "next Friday" needs the chip step, and the expected values must be re-based on the same clock for both paths (see the clock note above).
