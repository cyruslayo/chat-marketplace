# CommerceMarket Durable Object and routing

Status: ready-for-agent
Type: task
Blocked by: 17, 21
Requested: 14 Oct 2026
Unlocks: 29
Lane: D: Commerce
PRD: `../PRD.md`

## Why

Commerce transactions need their own DO per slice 05.

## What to build

Add a `CommerceMarket` DO class (SQLite) in `apps/cloudflare`, wire the commerce pack's repositories to it via `do-sql-database.ts`, route commerce requests, store product images and receipts in R2.

## Out of scope

- Merchant back office hosting decisions beyond routing.

## Acceptance criteria

- AC1: Commerce data lives only in the commerce DO.
- AC2: Order creation and checkout run under the Workers test suite.
- AC3: Shortlet Workers tests pass unchanged.

## Tests

Workers Vitest additions.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0095-host-the-pilot-on-cloudflare.md` | As amended by slice 05. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
