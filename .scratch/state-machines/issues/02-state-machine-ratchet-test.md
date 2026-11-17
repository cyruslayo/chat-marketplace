# 02 Ratchet test keeps the map current

Status: resolved
Type: task
Track: A
Blocked by: 01

## What to build

Add `test/state-machine-inventory.test.ts`, following the ratchet style in `test/domain-boundary.test.ts`.

- **Scan** `domains/shortlet/src`, `packages/platform-core/src`, `apps/local-guest/src` and `apps/web-agent/src`. Skip files and paths that contain `commerce`.
- **Collect** two shapes:
  - `export type <Name>` where `<Name>` ends in `Status`, `Stage`, `State`, `Lifecycle` or `Mode`, and the right-hand side is a string-literal union or `(typeof X)[number]`.
  - `export const <NAME>_(STATUSES|STATES|STAGES) = [...] as const`.
- **Compare** the collected names against the names that appear in backticks in `docs/agents/state-machines.md`.
- **Allow-list** names that match the pattern but are not lifecycles (for example a `GuestState` that is not a lifecycle). Put them in an explicit list in the test, each with a one-line reason.

## Acceptance criteria

1. An exported lifecycle union missing from the map fails the test, naming the file and the type.
2. A map entry for a type that no longer exists in the scanned code fails the test.
3. The test passes on this branch once issue 01's map is complete.

## Tests

- Run `npx tsx --test test/state-machine-inventory.test.ts`.
- Prove AC1 and AC2 with in-memory fixtures: run the comparison function against a fake source list. Do not edit real files.

## Comments

- Added `test/state-machine-inventory.test.ts` (node:test, node:assert/strict). Pure `findLifecycleTypes`, `mentionedLifecycleNames` and `compareInventory`; `ALLOW_LIST` with a reason per entry. Real scan covers the four folders; `commerce` paths are skipped.
- Allow-list (non-lifecycles, each with a reason in the test file): `PresentationMode` (display mode of a surface), `ConciergeMode` (deployment switch), `VisitorMode` (guest-conduct rule value), `JourneyStepState` (render-only step view state), `AssistantDiagnosticStage` (closed diagnostic log label, ADR 0075).
- Commands: `env -u LLM_API_KEY npx tsx --test test/state-machine-inventory.test.ts`: 4 tests, 4 pass, 0 fail, about 6.4 s. `env -u LLM_API_KEY npm run check`: exit 0.
- AC1 (`AC1: An exported lifecycle union missing from the map fails the test, naming the file and the type`): in-memory fakes, passes.
- AC2 (`AC2: A map entry for a type that no longer exists in the scanned code fails the test`): in-memory fakes, passes.
- AC3 (`AC3: The test passes on this branch once issue 01's map is complete`): real scan, zero missing, zero stale, zero stale allow-list entries.
- Extra test `Paths containing commerce are skipped by the scan` (not an AC).
- Definition of Done: items 1 and 2 met. Item 3 not met (ADRs not all read from `docs/adr/`). Item 7's `npm test` is deferred to the once-per-batch pre-merge gate per the Test scope rule.
- Status left `ready-for-agent` because DoD item 3 is not met and issue 01's AC2 is open.
- Orchestrator review (2026-11-17): AC2 gap closed by filing issue 25 (never-written states, owner question 2) and pointing the map rows at it. DoD 3: this docs-only change cites the PRD's governing-ADR table, which was read when the PRD was written; no ADR constrains the map itself. DoD 7: the full `npm test` and `test:workers` are the batch gate (AGENTS.md Test scope). Re-ran `npx tsx --test test/state-machine-inventory.test.ts`: 4 pass, 0 fail.
