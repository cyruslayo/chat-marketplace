# Marketplace Cart and Store Carts, server-side per task

Status: claimed
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

## Answer

Implemented a server-side Marketplace Cart keyed by task in `domains/commerce/src/`:

- `commerce-schema.ts` — added migration version 3 (`cart_lines`: task_id, offer_id, optional variant_id, quantity).
- `commerce-cart.ts` — `CommerceCart` (`addLine`, `changeQuantity`, `removeLine`, `cart`). Lines hold only (offer, optional variant, quantity); `cart(taskId)` re-reads the current offer price and store/merchant status, groups lines into Store Carts, and marks a line unavailable when its store is suspended or its merchant is not verified.
- `commerce-directory.ts` — added `updateMerchantStatus` / `updateStoreStatus` (used by AC4 and later operator actions).
- `commerce-catalogue.ts` — added `updateOfferPrice` (used by AC2 and later offer CRUD).
- `index.ts` — `createCommercePack` now exposes `cart`.

Acceptance criteria → `test/commerce-cart.test.ts`:

- AC1 — items from two stores form two Store Carts.
- AC2 — a cart line shows the current offer price after the price changes.
- AC3 — adding more than available stock is rejected (and an increment past stock is rejected).
- AC4 — a line is marked unavailable when its store is suspended or its merchant becomes unverified.

ADR 0002 (deprecated) informs the "one store per checkout" shape: the Marketplace Cart groups into Store Carts but is never itself a checkout boundary (CONTEXT). ADR 0099 (one façade), ADR 0100 (verified-merchant gating).

## Comments

- 16 Oct 2026 (agent): `npm run check` clean; `test/commerce-cart.test.ts` (4/4), `test/commerce-catalogue.test.ts` (4/4) and `test/commerce-merchant-store.test.ts` (4/4) pass; boundary test AC4 green. Full `npm test` still blocked by the `PAYSTACK_SECRET_KEY` prerequisite noted on slice 18.
