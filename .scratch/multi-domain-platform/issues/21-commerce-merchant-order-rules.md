# Merchant Order: port instastore order rules and lifecycle

Status: ready-for-agent
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

## Comments
