# Shrink domains/shortlet/src/index.ts to the façade; empty the boundary allow-list

Status: ready-for-agent
Type: task
Blocked by: 09b, 06
Requested: 14 Oct 2026
Unlocks: 16
Lane: B: Deep modules
PRD: `../PRD.md`

## Why

798 exports make the interface as large as the implementation (PRD, Diagnosis 1).

## What to build

1. Replace `export *` lines in `domains/shortlet/src/index.ts` with explicit exports of the façade(s), their public types, and what `apps/` genuinely needs (repository construction for hosts may stay via a single `createShortletPack(deps)`).
2. Remove every allow-list entry from slice 06 by routing imports through `index`.
3. Record the export count in `map.md`.

## Out of scope

- Moving payments or accounts out (15, 16).

## Acceptance criteria

- AC1: The slice-06 allow-list is empty and the boundary test passes.
- AC2: `domains/shortlet/src/index.ts` has no `export *` and fewer than 50 exported names (or the remaining count and reason are recorded).
- AC3: Existing tests pass unchanged.

## Tests

Boundary test from slice 06; existing tests.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0003-build-an-extensible-concierge-platform.md` | Domain pack boundary. |
| ADR from slice 01 | Module boundary rule. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
