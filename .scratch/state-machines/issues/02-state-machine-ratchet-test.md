# 02 Ratchet test keeps the map current

Status: ready-for-agent
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
