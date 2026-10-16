# Merchant back office: delivery zones and order fulfilment

Status: claimed
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

## Answer

Implemented merchant order fulfilment scoping and read-back:

- `MerchantBackOffice.merchantOrders` / `transitionOrder` / `nextOrderStatuses` (a merchant acts only on its own stores' orders; only allowed transitions are offered and accepted).
- `CommerceOrders.ordersForStore` read method.
- The consumer-facing status read is `CommerceOrders.orderByPublicCode` (already from slice 21), so a merchant transition is reflected there immediately.

Acceptance criteria → `test/merchant-back-office-orders.test.ts`:

- AC1 — a merchant can only act on its own orders.
- AC2 — only allowed status transitions are offered and accepted.
- AC3 — the consumer's order status reflects the change.

ADR compliance: 0001 (merchant fulfilment obligation), 0099 (one façade), 0100 (Merchant Order per store).

## Comments

- 16 Oct 2026 (agent): `npm run check` clean; all commerce tests pass; boundary test AC4 green. Delivered together with slice 25a as the merchant back office.
