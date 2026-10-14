# Shortlet façade, remaining applications; .manager. reach-throughs to zero

Status: ready-for-agent
Type: task
Blocked by: 09a, 08b
Requested: 14 Oct 2026
Unlocks: 10
Lane: B: Deep modules
PRD: `../PRD.md`

## Why

Finish removing the pass-through layer (PRD, Diagnosis 2).

## What to build

Repeat slice 09a for every remaining `apps/web/src/*-application.ts` with `readonly manager`. Record the before/after `.manager.` count in `## Answer` and update the metric in `map.md`.

## Out of scope

- Shrinking `index.ts` exports (10).

## Acceptance criteria

- AC1: No class in `apps/web/src` exposes `readonly manager`.
- AC2: `grep -rn '\.manager\.' apps --include=*.ts` (non-test) returns zero.
- AC3: Existing tests pass unchanged.

## Tests

Existing tests; façade tests for newly public operations.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0004-web-and-backend-own-authoritative-state.md` | State authority unchanged. |
| `docs/adr/0003-build-an-extensible-concierge-platform.md` | Domain owns its rules. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
