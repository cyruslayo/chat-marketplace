# Marketplace Cart and Store Carts, server-side per task

Status: ready-for-agent
Type: task
Blocked by: 19
Requested: 14 Oct 2026
Unlocks: 21
Lane: D: Commerce
PRD: `../PRD.md`

## Why

instastore's cart lives in the browser; the agent needs a server-side cart (CONTEXT: Marketplace Cart grouped into Store Carts, never itself a checkout boundary).

## What to build

Cart repository keyed by consumer/task: add, change quantity, remove; grouped by store; prices re-read from offers on every read.

## Out of scope

- Checkout (21, 22).

## Acceptance criteria

- AC1: Items from two stores form two Store Carts.
- AC2: A cart line whose offer price changed shows the current price.
- AC3: Adding more than available stock is rejected.
- AC4: A cart line for a suspended store or unverified merchant is marked unavailable.

## Tests

One test per AC.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0002-nigeria-launch-payments-use-store-checkouts.md` | One store per checkout (as revalidated by slice 04). |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
