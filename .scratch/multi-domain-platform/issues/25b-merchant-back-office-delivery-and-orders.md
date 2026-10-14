# Merchant back office: delivery zones and order fulfilment

Status: ready-for-agent
Type: task
Blocked by: 25a, 21
Requested: 14 Oct 2026
Unlocks: none
Lane: D: Commerce
PRD: `../PRD.md`

## Why

Merchants fulfil orders; instastore's admin orders and delivery screens are the reference.

## What to build

Delivery zone management and an order list with status transitions from slice 21 (Processing → Shipped → Fulfilled, Cancelled).

## Out of scope

- Logistics integrations.

## Acceptance criteria

- AC1: A merchant can only act on their own orders.
- AC2: Only allowed status transitions are offered and accepted.
- AC3: The consumer's order status reflects the change.

## Tests

One test per AC.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0001-merchants-are-sellers-of-record.md` | Fulfilment obligation. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
