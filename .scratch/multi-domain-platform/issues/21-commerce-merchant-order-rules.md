# Merchant Order: port instastore order rules and lifecycle

Status: claimed
Type: task
Blocked by: 20
Requested: 14 Oct 2026
Unlocks: 22, 23, 24, 25b
Lane: D: Commerce
PRD: `../PRD.md`

## Why

instastore's most valuable logic is `create_store_order` / `set_order_status` in plpgsql (PRD, 'Rules from instastore').

## What to build

Implement Merchant Order creation from one Store Cart and the status lifecycle in TypeScript on `SqlDatabase`, porting every rule listed in the PRD from `instastore/supabase/migrations/0017_payment_verification_fact.sql` and `src/lib/orderWorkflow.ts`. Use a transaction for stock decrement (see `.scratch/cloudflare-deployment` spike notes on `transactionSync`).

## Out of scope

- Payment collection (22).

## Acceptance criteria

- AC1: An order for an inactive store, or with a delivery zone of another store or inactive, is rejected.
- AC2: The order total is recomputed server-side; a tampered submitted total is ignored or rejected.
- AC3: Stock is decremented atomically and an oversell is rejected.
- AC4: A retried creation with the same payment reference returns the same order.
- AC5: Only allowed status transitions succeed; the first move to Processing records the payment-verified fact once.

## Tests

One test per AC, with failure paths.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0001-merchants-are-sellers-of-record.md` | Seller of record on each order. |
| ADR from slice 04 | Payment and order boundary. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Answer

Implemented the Merchant Order lifecycle in `domains/commerce/src/`:

- `order.ts` — `MerchantOrderStatus` + `NEXT_ORDER_STATUSES` (ported from instastore `orderWorkflow.ts`), `OrderItem`/`MerchantOrder` types, `normalizePhone` (digits and `+` only), fail-closed parsers.
- `commerce-order.ts` — `CommerceOrders` (`createOrder`, `transitionStatus`, `orderById`, `orderByPublicCode`).
- `commerce-schema.ts` — migration version 4 (`merchant_orders`).
- `index.ts` — `createCommercePack` now exposes `orders`.

`createOrder` ports instastore `create_store_order`: active store; active delivery zone belonging to that store; non-blank customer name; normalized phone ≥ 7 digits; non-empty shipping address; at least one item with no duplicate products; each offer belongs to the store and has enough stock; stock decremented in a single transaction; subtotal/total recomputed server-side (tampered submitted total rejected); idempotent retry on the payment reference. `transitionStatus` ports `set_order_status`: only the allowed transitions succeed, cancellation restocks, and the first `Pending Verification → Processing` stamps `payment_verified_at`/`payment_event_id` once.

Acceptance criteria → `test/commerce-order.test.ts`:

- AC1 — inactive store, another store's delivery zone, and an inactive zone are each rejected.
- AC2 — the total is recomputed server-side; a tampered submitted total is rejected.
- AC3 — stock is decremented atomically; an oversell is rejected.
- AC4 — a retry with the same payment reference returns the same order (and a different phone is rejected).
- AC5 — only allowed transitions succeed; the first move to Processing records the payment fact once.

ADR compliance: 0001 (seller of record on the order), 0099 (one façade), 0100 (Merchant Order per store, merchant verification). The "one store per checkout" boundary is ADR 0002 (deprecated; revalidated by slice 04).

## Comments

- 16 Oct 2026 (agent): `npm run check` clean; `test/commerce-order.test.ts` (5/5) plus slices 18–20 tests (12/12) pass; boundary test AC4 green. Full `npm test` still blocked by the `PAYSTACK_SECRET_KEY` prerequisite noted on slice 18.
