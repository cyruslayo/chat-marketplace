# Commerce catalogue: Product, Merchant Offer, Variant, delivery zones, R2 images, search

Status: claimed
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

## Answer

Implemented the commerce catalogue in `domains/commerce/src/`:

- `commerce-schema.ts` — added migration version 2 (`products`, `merchant_offers`, `offer_variants`, `delivery_zones`); versions 1–2 are the ordered `COMMERCE_SCHEMA_MIGRATIONS`.
- `product.ts` — Product (shared descriptive identity), Merchant Offer (store-specific price/compare-at/stock), Offer Variant (own stock); fail-closed parsers, integer kobo validation, compare-at > price, max 4 image keys.
- `delivery-zone.ts` — DeliveryZone (`Abuja`/`Lagos` city, non-blank name/provider, non-negative integer fee, `sortOrder`, `isActive`).
- `commerce-catalogue.ts` — `CommerceCatalogue` (`createProduct/createOffer/createVariant/createDeliveryZone`, `searchOffers`, `selectVariant`, `activeDeliveryZones`). `searchOffers` joins merchants/stores and returns only in-stock offers of active stores of verified merchants, then applies text/category/sort filters (ported from instastore `catalogDiscovery`). `selectVariant` fails closed on an out-of-stock variant. `activeDeliveryZones` returns only active zones of the given store.
- `index.ts` — `createCommercePack` now also exposes `catalogue`.

Acceptance criteria → `test/commerce-catalogue.test.ts`:

- AC1 — search returns only in-stock offers from active stores of verified merchants (out-of-stock, pending-merchant and suspended-store offers excluded).
- AC2 — a variant has its own stock; an out-of-stock variant is rejected.
- AC3 — a delivery quote returns only an active zone belonging to the store (inactive zone and another store's zone excluded).
- AC4 — prices are integer kobo; a float price is rejected.

ADR compliance: 0001 (merchant/store offer identity), 0099 (one façade), 0100 (Product + Merchant Offer model). ADR 0015 (all-in pricing) is shortlet-only and does not apply: commerce keeps item price + delivery fee, in integer kobo. Product image keys (max 4) are stored on the Product; actual R2 upload is slice 24.

## Comments

- 16 Oct 2026 (agent): `npm run check` clean; `test/commerce-catalogue.test.ts` (4/4) and `test/commerce-merchant-store.test.ts` (4/4) pass; boundary test AC4 green (no `domains/commerce` deep imports). Full `npm test` remains blocked in this session by the pre-existing `PAYSTACK_SECRET_KEY` environment prerequisite noted on slice 18.
