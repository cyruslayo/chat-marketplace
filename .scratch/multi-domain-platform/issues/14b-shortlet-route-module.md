# Shortlet route module composed by the shell

Status: ready-for-agent
Type: task
Blocked by: 14a
Requested: 14 Oct 2026
Unlocks: 27
Lane: B: Deep modules
PRD: `../PRD.md`

## Why

Finish making the web host thin (PRD, Diagnosis 5).

## What to build

Move shortlet routes, page renderers and event wiring out of `guest-server.ts` into a shortlet route module (one file per page group, organized by workflow). `guest-server.ts` keeps only composition. Record the new line count in `map.md`.

## Out of scope

- Changing pages.

## Acceptance criteria

- AC1: `guest-server.ts` contains only composition and is under 1,000 lines (or the remainder is justified).
- AC2: Every existing route responds identically.
- AC3: Capture sweep shows no visual diff.

## Tests

Existing tests.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0078-meet-an-accessible-nigerian-launch-profile.md` | No UI regression. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
