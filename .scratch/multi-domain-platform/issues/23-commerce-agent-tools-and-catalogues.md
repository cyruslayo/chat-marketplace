# Commerce agent tools, commerce-* catalogues and presentations

Status: ready-for-agent
Type: task
Blocked by: 13, 21, weaver-catalogues 03
Requested: 14 Oct 2026
Unlocks: 27, 29
Lane: D: Commerce
PRD: `../PRD.md`

## Why

The concierge must be able to shop.

## What to build

1. Pack tools: `search_products`, `get_offer`, `quote_delivery`, `add_to_store_cart` (read/cart), `propose_checkout` (proposal → platform command), `get_order_status`.
2. Presentations (data only, like `apps/web-agent/src/*-presentation.ts`) and A2UI for `commerce-discovery/v1`, `commerce-cart/v1`, `commerce-order/v1`, registered through slice 11 and built with the catalogue runtime factory from weaver-catalogues 03.
3. Deterministic parity for checkout (ADR 0080).
4. Commerce prompt section; no shortlet vocabulary leaks.

## Out of scope

- Shell task rail (26), store pages (27).

## Acceptance criteria

- AC1: A shopping intent starts a commerce task and only commerce tools are offered.
- AC2: `propose_checkout` never pays without an explicit confirmation command.
- AC3: Commerce surfaces use only registered commerce or common catalogues.
- AC4: The checkout flow has a deterministic path.

## Tests

Scripted-assistant tests through the shared fixture; one per AC.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0072-route-consequential-actions-through-platform-commands.md` | Checkout confirmation. |
| `docs/adr/0073-govern-domain-specific-a2ui-catalogues.md` | New catalogues need review. |
| `docs/adr/0080-retain-deterministic-parity-for-critical-workflows.md` | Parity. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
