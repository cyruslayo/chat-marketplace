# One parity suite that runs the same guest text through both concierges

Status: ready-for-agent
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

- Owner decision (2 Nov 2026): stays blocked by 04, 05, 11, 13 (order above).

### Owner decisions (3 Nov 2026, recorded by the coordinator)

1. AC2 ("show me the last one"): a deterministic pack hook on the assistant path, in the style of `viewResultIntent`, through the `answerValidatedTurn`-style seam. Not a planner tool.
2. AC3: this issue includes the fix. A `search` verdict that carries only a place word on a sent stay must not reach `search_stays` or replace the current results. The row passes on both paths.
3. Clock: one clock (27 Oct 2026) serves both paths. The parity fixture runs both paths on it. Expected values in existing deterministic tests were not re-based in this run (see the run record).
4. AC4: the live script is owner-run, paid, not part of `npm test`, and logs no guest text (ADR 0075). It is written by the implementing agent, never run by it.

### Run record (agent, 3 Nov 2026): partial, status ready-for-agent

Built so far:
- `test/helpers/parity-fixture.ts` (AC5): the shared fixture. It runs each row's turns on the deterministic app and on the assistant app over one datedFixture per path, on the staging clock (27 Oct 2026), with a staging-like guest, and a cold restore before every event (a new `LocalGuestApp` or `restartedDatedApp` over the same store). It compares the criteria strip (where, when, guests, budget) and the surface kinds. It reuses `guest-date-fixtures` (`datedFixture`, `restartedDatedApp`, `firstButtonAction`, `scriptedPlanner`, `LIVE_LIKE_CLOCK`, `STAGING_GUEST_CONFIG`). It does not copy them.
- `test/assistant-parity.test.ts` (AC1): eight rows, one test each: issues 04 and 05 (search with check-in and nights), 07 (budget from words), 08 (closed-list amenity), 04 (relative check-in shown back), 13 (nights change on a draft is a replacement), 13b (relative date on a draft is shown back), 09 (same-city neighbourhood switch), and the unrelated-turn row (the results stay).
- Fix in `apps/local-guest/src/shortlet-app.ts` (`#assistantContextSearch`): while an assistant date show-back is open and no Request Draft is open, the criteria strip shows the held stay "to confirm" (the deterministic path does this). With a draft open, the draft's criteria stay (the deterministic path keeps them). This was a real parity gap: the assistant strip was empty during a date show-back.

Commands and counts (all `env -u LLM_API_KEY`):
- `npx tsx --test test/assistant-parity.test.ts`: 8 pass, 0 fail (before the fix: row 4 failed on the empty criteria, row 7 failed on the pending date showing on a draft; both fixed).
- `npm run check`: exit 0.
- Regression, criteria and date suites (13 files): assistant-draft-revision, assistant-date-phrases, assistant-checkout-dates, assistant-discovery-view, assistant-persistent-continuity, guest-chip-continuity, guest-real-dates, guest-draft-revision, assistant-cold-journey, assistant-date-clarification-copy, assistant-clarification-chips, assistant-recorded-journeys, stay-date-phrases: 87 pass, 0 fail.

Open (not done in this run; the issue stays `ready-for-agent`):
- AC2 ("show me the last one"): not built. The pack hook needs a way to open a unit detail from a text-only seam. `answerValidatedTurn` returns text only, so the runtime needs a path that runs a server-chosen `get_unit_details` call and its stage handler, with no planner round. Owner decision 1 is recorded; the seam change is the next step.
- AC3 failure path: the place-only search on a sent stay is not fixed and no row covers it. It needs a sent-stay row, which needs a contact step (the staging guest has no phone; Review asks for one). The fixture supports taps but not contact values yet.
- Rows not written: issue 05 (checkout phrase), issue 11 (facility answer and stage reply), issue 12 (explanation after submission; needs the sent-stay setup above), and the two unchecked behaviours beyond the unrelated turn (view-last is AC2).
- Clock: existing deterministic test files (`guest-real-dates`, `guest-draft-revision`, `guest-must-fix-ux`, `guest-discovery-reasons-chromium`) still use their own 3 Sept 2026 fixture. They were not re-based because the parity suite gets its own environment and nothing forces it. If owner decision 3 needs those files re-based, it is a separate change and is not made here.
- AC4 live script: not written. It needs the staging model client wired for k = 5 runs and a closed-outcome report; it stays owner-run.
- The full `npm test` and `npm run test:workers` are left to the batch gate.
