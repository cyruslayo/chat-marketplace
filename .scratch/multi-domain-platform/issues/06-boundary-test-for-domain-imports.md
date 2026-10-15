# Boundary test: no imports past domains/*/src/index

Status: resolved
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

## Answer

Landed:
- `test/domain-boundary.test.ts` — scans non-test `.ts` files outside `domains/<d>/` for import specifiers that resolve past `domains/<d>/src/index`, and compares them to an allow-list. Unknown keys are outside a domain's `src` or its own `index`, and same-domain imports are allowed (ADR 0099 rule 1). No new mechanism: it follows `test/weaver-dependency-boundary.test.ts`.
- `test/fixtures/domain-boundary-allowlist.json` — today's 91 offending (file, module) pairs across 39 files / 41 modules, matching the PRD's "41 internal modules imported past index".

Tests (one per AC, `test/domain-boundary.test.ts`):
- AC1 "A new deep import outside the allow-list fails the test" — green.
- AC2 "A stale allow-list entry (pair no longer present) fails the test" — green.
- AC3 "Imports through domains/<d>/src/index and imports inside the same domain pass" — green.
- AC4 "The repository has no unlisted deep import and no stale allow-list entry" — green (the ratchet holds on the real tree).

Verification: `npm run check` clean. `npm run test:non-browser` phase 1: 1743 pass / 4 fail, and the 4 failures reproduce unchanged on the stashed baseline (`test/export-node-sqlite.test.ts`, `test/redact-platform-ids-{detection,generators}.test.ts`) — they are pre-existing and unrelated to this slice. The allow-list only shrinks; slice 10 empties it.

## Comments

- 14 Oct 2026 (agent): Scoped the scan to non-test `.ts` files outside `domains/`, skipping `.scratch` (the effort/issue-tracker scratch area of throwaway scripts), `node_modules`, `vendor`, build output. With those exclusions the module count is the PRD's 41.
