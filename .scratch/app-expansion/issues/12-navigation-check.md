# Navigation table and reachability check

Status: ready-for-agent
Type: task
Blocked by: none

## What to build

- `test/guest-navigation.test.ts` with one table of guest routes: path, kind (section, task, state) and expected exits, taken from `guest-server.ts` and the route modules.
- The test renders each route through the real handler (`guest-route-harness.ts`, `guest-stage-pages.ts`) and reads its links and forms.
- Today's gaps (no Help, no list) are recorded as expected gaps with the issue that closes each, so the table can only improve (a ratchet, like `state-machine-inventory.test.ts`).

## Acceptance criteria

- AC1: A guest route missing from the table fails the test.
- AC2: Every page has an exit that is not the browser's Back. Failure path: a fixture page without one is reported by name.
- AC3: No internal link leads to a route the server does not serve.
- AC4: Removing a recorded gap without fixing it fails; fixing it without removing the record also fails.

## ADR compliance

0078, 0080.

## Comments
