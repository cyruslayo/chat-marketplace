# Cloudflare platform Durable Object (accounts, conversations) and Worker routing by domain

Status: ready-for-agent
Type: task
Blocked by: 05, 13, 16
Requested: 14 Oct 2026
Unlocks: 24
Lane: C: Platform services
PRD: `../PRD.md`

## Why

Today `apps/cloudflare/src/worker.ts` routes everything to `ShortletPilot` (slice 05 decision).

## What to build

1. Add a platform DO class (SQLite) holding accounts, threads and tasks; the shortlet DO keeps shortlet transactions.
2. The Worker routes by path/domain; pack calls between DOs go through a small typed client.
3. Migration for existing pilot data per slice 05; extend `apps/cloudflare` Workers Vitest.

## Out of scope

- Commerce DO (24).

## Acceptance criteria

- AC1: Accounts and conversations are served from the platform DO.
- AC2: Shortlet flows pass the Workers test suite unchanged.
- AC3: Existing pilot data migrates (tested with an exported fixture).

## Tests

`apps/cloudflare/test` Workers Vitest additions.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0095-host-the-pilot-on-cloudflare.md` | Hosting, as amended by slice 05. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
