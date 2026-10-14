# Commerce catalogue: Product, Merchant Offer, Variant, delivery zones, R2 images, search

Status: ready-for-agent
Type: task
Blocked by: 18
Requested: 14 Oct 2026
Unlocks: 20, 25a
Lane: D: Commerce
PRD: `../PRD.md`

## Why

The agent needs searchable offers with sizes/colours and delivery terms.

## What to build

Port from instastore (`products`, `0010_storefront_tenancy_and_delivery_zones.sql`, `0012_delivery_zone_ordering.sql`, `0013_product_merchandising.sql`, `src/lib/catalogDiscovery.ts`, `src/lib/deliveryZones.ts`) to commerce repositories: Product, Merchant Offer (price, compare-at, stock), Variant, DeliveryZone (city, zone, fee, estimate, active), images via the platform blob store. Search over verified, active stores' in-stock offers.

## Out of scope

- Cart and orders.

## Acceptance criteria

- AC1: Search returns only in-stock offers from active stores of verified merchants.
- AC2: A variant has its own stock; an out-of-stock variant cannot be selected.
- AC3: A delivery quote uses only an active zone belonging to the offer's store.
- AC4: Prices are integer kobo (or the unit slice 03 decides), never floats.

## Tests

One test per AC.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0015-use-all-in-pricing-throughout-the-booking-funnel.md` | Consider all-in pricing for commerce; record the decision if it differs. |
| ADR from slice 03 | Product identity choice. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
