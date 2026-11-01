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
