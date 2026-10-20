# Merchant Order: port instastore order rules and lifecycle

Status: resolved
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
| `docs/adr/0004-web-and-backend-own-authoritative-state.md` | The server owns price, stock, order and lifecycle state. |
| `docs/adr/0075-secure-and-minimize-agent-interaction-data.md` | Payment references stay out of logs, audit and interaction state. |
| `docs/adr/0096-export-payment-references-in-plaintext.md` | The plaintext exception applies only to named Shortlet export columns. |
| `docs/adr/0099-define-the-domain-pack-interface-and-module-boundaries.md` | Commerce exposes one façade and owns its transaction model. |
| `docs/adr/0100-make-commerce-the-second-domain.md` | Stores offered to consumers are active and their merchants are verified. |
| `docs/adr/0101-multi-domain-cloudflare-hosting-and-platform-accounts.md` | Commerce owns its Durable Object and transaction tables. |
| `docs/adr/0103-adopt-commerce-discovery-cart-and-order-catalogues.md` | Checkout stays unavailable until payment is connected; `payment_unavailable` creates no order. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Answer

The Merchant Order lifecycle lives in `domains/commerce/src/`. `CommerceOrders` owns order creation, transitions, idempotency, stock changes, tracking projections, and attempt locks. The migration ledger creates `merchant_orders` and tracking-attempt tables.

`createOrder` requires an active store, a verified merchant, an active delivery zone for that store, valid customer and address fields, and valid offers. It computes the total from current server data. It decrements stock and inserts the order in one transaction. If a later item oversells, the transaction rolls back earlier stock changes. Cancellation restores stock once. A retry with the same reference and canonical phone returns the existing order.

The payment reference is stored as a keyed HMAC-SHA-256 value, formatted `<keyId>:<64 lowercase hex>`. The raw reference does not appear in the order projection, database, logs, audit records, or commerce export. Migration 6 refuses a legacy database with orders because SQLite cannot create the keyed hash. No order-upgrade converter is included.

Only an active store with a verified merchant can create an order or pass the internal checkout quote. The approved public code prefix is `ORD-`; the implementation appends 32 uppercase hexadecimal characters. The normalized phone minimum remains 7 characters, as recorded in `domains/commerce/CONTEXT.md`.

**Acceptance criteria and tests**

- AC1 — `test/commerce-order.test.ts`: `AC1: an order for an inactive store, or with a delivery zone of another store or inactive, is rejected`. The test covers an inactive store, a foreign zone, and an inactive zone. `issue 24 decision 11` separately covers an unverified merchant.
- AC2 — `test/commerce-order.test.ts`: `AC2: the order total is recomputed server-side and a tampered submitted total is rejected`. It checks the correct total and refuses a forged total.
- AC3 — `test/commerce-order.test.ts`: `AC3: stock is decremented atomically and an oversell is rejected`. It refuses excess stock. `issue 24 decision 13` checks rollback when item 2 oversells and item 1's stock remains unchanged.
- AC4 — `test/commerce-order.test.ts`: `AC4: a retried creation with the same payment reference returns the same order`. It rejects reuse with a different phone. `issue 24 decision 7` confirms the raw reference never reaches storage or the returned order.
- AC5 — `test/commerce-order.test.ts`: `AC5: only allowed status transitions succeed and the first move to Processing records the payment-verified fact once`. It refuses invalid transitions and verifies the fact stays stable on repeat.

**ADR constraints**

| ADR | Constraint | Code path or test |
| --- | --- | --- |
| 0001 | Merchant is the seller of record. | `MerchantOrder.storeId`; orders are store-scoped. |
| 0004 | The server owns price, stock, order, and lifecycle facts. | Server-side total calculation and transactional order repository. |
| 0075 | Bearer credentials stay out of logs, audit, and interaction state. | Keyed reference hash and minimal tracking projection. |
| 0096 | Plaintext payment-reference exception covers only named Shortlet export columns. | Commerce stores and exports only the keyed hash. |
| 0099 | Each domain has one public façade and owns its transaction model. | Commerce pack façade and migration ledger. |
| 0100 | A store must be active and its merchant verified before it is offered. | `#buildOrder`; test `issue 24 decision 11`. |
| 0101 | Commerce owns its Durable Object and tables. | `CommerceMarket`; order repository uses its `SqlDatabase`. |
| 0103 | Checkout without a connected payment executor returns `payment_unavailable` and creates no order. | Internal checkout returns 409 `payment_unavailable` without invoking `createOrder` (issue 24 AC2). |

ADR 0002 is deprecated. Slice 04 remains `needs-info`, so payment collection stays out of scope under issue 22. The one-store Merchant Order boundary remains in `domains/commerce/CONTEXT.md`.

ADR 0103 records only the checkout-unavailable boundary: `payment_unavailable` (409) prevents order creation because the internal checkout path returns it without calling `createOrder`, so no order row is written and no stock is reserved. ADR 0103 does not define the AC1–AC5 order-creation rules; those live in `CommerceOrders`.

**Definition of Done — checked at closeout**

| Item | Evidence | State |
| --- | --- | --- |
| 1. Named test for each acceptance criterion | AC1–AC5 tests above; one test block per criterion. | Passed in the final full suite. |
| 2. Named failure paths | Inactive or foreign data, forged total, oversell and rollback, mismatched phone, and invalid transitions. | Passed in the final full suite. |
| 3. Relevant ADRs listed and read | ADRs 0001, 0004, 0075, 0096, 0099, 0100, 0101, and 0103. | Verified against the constraint table above. |
| 4. No unused injected dependency | `CommerceOrders` uses its database, clock, keys, and tracking policy. | Final standards review found no blocker. |
| 5. No invented policy | Phone minimum and `ORD-` prefix decisions are recorded; emitted suffix is 32 uppercase hexadecimal characters. | Verified; no payment policy inferred. |
| 6. No restricted data in logs or audit | Payment-reference tests and export projection verify the keyed hash only. | Tests passed; final review found no blocker. |
| 7. Type check and full test suite pass | Code commit `e77e03a64d4564d727d1b0a6c6a3f84c12c6ba95`: final type check, full suite and two Workers runs exited 0. | Passed; user-approved fast-forward to `main` completed. |

**Final validation and integration (20 Oct 2026)**

- `npm run check` — exit 0; all TypeScript checks and the Worker bundle guard passed.
- `NODE_ENV=test npm test` — exit 0; phase 1: 263 files, 1,980/1,980 passed; phase 2: 34/34 browser files passed, 183 tests, 181 passed, 2 skipped, no failures or timeouts.
- `npm run test:workers` — two serial complete runs, each exit 0 with 23 files and 159 tests passed. These are separate from `npm test`.
- Independent standards/spec review and the routing-fix follow-up review are complete with no remaining blocker. The user approved integration; local `main` was fast-forwarded to the tested code commit above. The user then requested resolution of issues 21 and 24.
- Raw log names, exit sidecars, review artifacts and preservation evidence are recorded in [issue 24's final validation](24-commerce-durable-object-and-routing.md#final-validation-and-integration).

**Earlier validation on commit `06134baf9be91ad14df74cbf04078af95139f8ec` (historical)**

- `node --import tsx --test test/commerce-order.test.ts test/commerce-reference-hash.test.ts test/commerce-schema-guard.test.ts test/commerce-alarm-plan.test.ts test/commerce-ops-import-boundary.test.ts` — exit 0, 48/48. Log: `%TEMP%\opencode\codex-mdp24-06134ba-focused.log`.
- `node --import tsx --test test/test-env-defaults.test.ts` — exit 0, 4/4. This checks runner child environment defaults, not Merchant Order behavior. Log: `%TEMP%\opencode\codex-mdp24-06134ba-env.log`.
- `npm run check` — exit 0. Log: `%TEMP%\opencode\codex-mdp24-06134ba-check.log`.
- Full-suite, Workers, review and integration gates were pending at that checkpoint; the final validation above supersedes that pending state.

## Comments

- 16 Oct 2026 (agent): `npm run check` clean; `test/commerce-order.test.ts` (5/5) plus slices 18–20 tests (12/12) pass; boundary test AC4 green. Full `npm test` still blocked by the `PAYSTACK_SECRET_KEY` prerequisite noted on slice 18.

### Implementation record (20 Oct 2026; preserved from the pre-acceptance draft)

Issue 24 carries the recorded decisions that refine this issue's implementation. They are reflected in branch commit `38a03dc` and its commerce changes:

- Order creation requires an active store and a verified merchant. The same gate applies to the internal checkout quote (ADR 0001 and 0100; `domains/commerce/src/commerce-order.ts`).
- AC3 includes the multi-item rollback failure path: when item 2 oversells, item 1's stock and the order ledger remain unchanged (`test/commerce-order.test.ts`, test `issue 24 decision 13`).
- Payment references use keyed HMAC-SHA-256. The raw reference is not stored in `merchant_orders`, returned, logged, or exported. The commerce export carries only the keyed hash (ADR 0075 and 0096; tests `issue 24 decision 7`).
- The approved public code is `ORD-` plus 32 uppercase hexadecimal characters. The minimum normalized phone length remains 7 characters, as recorded in `domains/commerce/CONTEXT.md` (user decision, 19 Oct 2026).
- Migration 6 refuses a legacy database with orders because SQLite cannot create the keyed hash. No order-upgrade converter is included. Key rotation remains separate until the Worker reads `previousKeys`.
- ADR 0002 is deprecated and slice 04 remains `needs-info`. Payment collection remains out of scope; checkout returns `payment_unavailable` until issue 22.

Harness integration commit `06134baf` was on the feature branch. Its environment test passed 4/4; it does not cover Merchant Order acceptance or Workers behavior. At that checkpoint, resolution was deferred pending the full suite, Workers gates, independent review, and approved `main` integration.

### Resolution (20 Oct 2026)

The required gates passed on code commit `e77e03a`, the user-approved fast-forward to local `main` completed, and the user explicitly requested closeout. All seven Definition of Done items are checked above. The preserved documentation corrections are incorporated here; no application code changed during closeout. Issue 22 remains blocked on slice 04; issue 29 is not started. Nothing was pushed or deployed.
