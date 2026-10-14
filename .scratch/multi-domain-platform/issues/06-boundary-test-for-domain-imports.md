# Boundary test: no imports past domains/*/src/index

Status: ready-for-agent
Type: task
Blocked by: none
Requested: 14 Oct 2026
Unlocks: 10
Lane: B: Deep modules
PRD: `../PRD.md`

## Why

74 non-test app files import shortlet code and 41 internal modules are imported past `index` (PRD, Diagnosis 1). A ratchet stops it getting worse while later slices shrink it.

## What to build

1. Follow the existing boundary tests (`test/sql-port-store-imports.test.ts`, `test/weaver-dependency-boundary.test.ts`) — do not invent a new mechanism.
2. Add `test/domain-boundary.test.ts`: scan non-test `.ts` files outside `domains/<d>/` for imports of `domains/<d>/src/<x>` where `<x>` is not `index`.
3. Seed an allow-list file (e.g. `test/fixtures/domain-boundary-allowlist.json`) with today's offending (file, module) pairs.
4. Fail when a pair not on the list appears; also fail when a listed pair no longer exists (so the list only shrinks).

## Out of scope

- Removing any existing deep import.

## Acceptance criteria

- AC1: A new deep import outside the allow-list fails the test.
- AC2: A stale allow-list entry (pair no longer present) fails the test.
- AC3: Imports through `domains/<d>/src/index` and imports inside the same domain pass.
- AC4: `npm run check` and `npm test` pass.

## Tests

One `test()` per AC in `test/domain-boundary.test.ts`, using small in-memory fixtures for the failure paths.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0003-build-an-extensible-concierge-platform.md` | Separate domain packs. |
| ADR from slice 01 | Module boundary rule, once accepted. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
