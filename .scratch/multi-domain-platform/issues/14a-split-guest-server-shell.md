# Split guest-server.ts: generic shell (sessions, conversation and action endpoints, assets)

Status: ready-for-agent
Type: task
Blocked by: 07
Requested: 14 Oct 2026
Unlocks: 14b
Lane: B: Deep modules
PRD: `../PRD.md`

## Why

`apps/local-guest/src/guest-server.ts` is 9,601 lines that know every feature (PRD, Diagnosis 5).

## What to build

1. Extract the generic parts into a shell module: HTTP routing table, session handling, conversation endpoint, the single action endpoint that calls the platform gate, static assets, security headers.
2. Define a `RouteModule` registration shape (from slice 02) and register all current shortlet routes through one module that still lives in `guest-server.ts` for now.
3. No route, status code or HTML output changes.

## Out of scope

- Moving shortlet routes into the pack (14b).

## Acceptance criteria

- AC1: The shell module has no shortlet imports.
- AC2: Every existing route responds identically (existing browser and HTTP tests pass).
- AC3: Guest UI walkthrough and `capture-11-all.sh` show no visual diff.

## Tests

Existing tests; a shell test registering a fake route module.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0004-web-and-backend-own-authoritative-state.md` | Server keeps authority. |
| `docs/adr/0078-meet-an-accessible-nigerian-launch-profile.md` | No UI regression. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
