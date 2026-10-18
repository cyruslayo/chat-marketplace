# CommerceMarket Durable Object and routing

Status: ready-for-agent
Type: task
Blocked by: 17, 21
Requested: 14 Oct 2026
Unlocks: 29
Lane: D: Commerce
PRD: `../PRD.md`

## Why

Commerce transactions need their own DO per slice 05.

## What to build

Add a `CommerceMarket` DO class (SQLite) in `apps/cloudflare`, wire the commerce pack's repositories to it via `do-sql-database.ts`, route commerce requests, store product images and receipts in R2.

## Out of scope

- Merchant back office hosting decisions beyond routing.

## Acceptance criteria

- AC1: Commerce data lives only in the commerce DO.
- AC2: Order creation and checkout run under the Workers test suite.
- AC3: Shortlet Workers tests pass unchanged.

## Tests

Workers Vitest additions.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0095-host-the-pilot-on-cloudflare.md` | As amended by slice 05. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments

### User decisions, 18 Oct 2026

Recorded from the user's answers to the open review questions. Status is unchanged.

- **Auth (ADR 0101):** `/api/commerce/*` is no longer public. The Worker answers 404 `NOT_FOUND` before routing, so no authority receives the request. Non-API paths keep their current Shortlet behaviour: no `/shop` or `/s` routing was added, and `CommerceMarket` serves nothing public yet. Public storefront routing for the PRD's `/s/<slug>` (`.scratch/multi-domain-platform/PRD.md:132`) lands with issue 27, once a page exists to serve. Order and checkout traffic reach `CommerceMarket` only through the typed internal client.
- **Unavailable payment (ADR 0096):** checkout returns 409 `payment_unavailable`, the same code string as issue 23's `commerce-checkout-command.ts`. It writes no order row and decrements no stock. No response carries `paymentReference`.
- **Response codes introduced by this slice:**

  | Code | HTTP status | Where |
  | --- | --- | --- |
  | `BAD_REQUEST` | 400 | Checkout body fails `parseCreateOrderInput` (malformed items, offerId, paymentReference or other fields) |
  | `ORDER_REJECTED` | 400 | Checkout fails a domain rule: unavailable store, zone or offer, insufficient stock, or submitted total mismatch |
  | `INVALID_SCOPE` | 403 | Internal request whose `tenantId` is missing or is not the DO's configured tenant |
  | `payment_unavailable` | 409 | Valid checkout; payment is not connected, so nothing is written |
  | `NOT_FOUND` | 404 | Any public `/api/commerce/*` request, refused by the Worker |
- **Export (ADR 0096, not amended):** `merchant_orders.payment_reference` is excluded from the commerce export, and the commerce DO writes no audit payloads that could carry it. The exported phone and address stay behind the ADR 0095 data-protection gates. Consequence: a restore of a day with orders cannot rebuild the NOT NULL `payment_reference` column from that export, so the restore runbook needs a follow-up before orders are live.
- **Checkout (internal only):** `/_internal/checkout` validates the store, offers, zone and server-computed total with the domain rules (`quoteCheckout`, which shares `#buildOrder` with `createOrder` and skips the stock write), then returns 409. Invalid checkouts return the existing 400 refusals. The typed `commerceCheckoutClient` sets the configured tenant after the caller's fields. It has no production caller yet.
- **Images (ADR 0101):** `R2ProductImageStore.put` validates with `InteractionSecurityEngine.validateFileUpload`, allowing JPEG, PNG and WebP up to 5 MiB. Both limits are named constants and can be overridden through the policy argument.
- **Still open:** the AC2 "product images in R2 wired through the DO" part, since no upload API exists yet. Image content sniffing is not in place: the store checks the declared MIME type and size only.
- **Still open (user decision pending):** the restore path for `payment_reference`. The export omits the column, which is NOT NULL and UNIQUE, so the restore runbook needs a follow-up before orders go live. Not changed in this slice.
- **Test changes to shared fixtures (AC3):** the Shortlet Workers tests pass. Additive edits were made to `restore-from-export.spec.ts`, `ops-test-helpers.ts` and `wrangler.test.jsonc` for the commerce namespaces and tenant.

### Implementation decisions, 18 Oct 2026

These supersede the Export, "Still open" and restore-path bullets above. Status is unchanged.

- **Decision 7, hashed payment reference (ADR 0096 not amended):** `merchant_orders` stores only `payment_reference_hash`, the SHA-256 of the trimmed reference (`hashPaymentReference` in `commerce-order.ts`). Migration 5 (`commerce-schema.ts`) rebuilds the table around the hash. Migration 4 is unchanged. Idempotent lookup hashes the incoming reference first. The MerchantOrder read model has neither the reference nor the hash, so no API returns either. The export now includes `payment_reference_hash` and never the raw value. The restore gap is closed: `restore-from-export.spec.ts` restores an export that holds an order, and a retry against the restored object returns the same order.
- **Decision 8, image content check:** `r2-product-image-store.ts` checks the magic bytes after `validateFileUpload`, using the named signatures `JPEG_SIGNATURE`, `PNG_SIGNATURE`, `WEBP_RIFF_SIGNATURE` and `WEBP_FORM_SIGNATURE`. A mismatch, or a type with no signature, is refused.
- **Decision 9 (user decision):** product image upload through the DO moves to the merchant back-office work. The AC2 part "product images in R2 wired through the DO" is therefore not part of this issue. No code.
- **Decision 11, merchant verification (ADR 0100, ADR 0001):** `#buildOrder`, which both `createOrder` and the internal checkout quote use, refuses unless the store is active and its merchant is verified, the same rule the catalogue applies. The refusal uses the generic "The store is unavailable." message. `normalizePhone` and `trackOrder` are unchanged.
- **Decision 13, multi-item rollback:** item 1 has stock, item 2 oversells, and the order is refused with item 1's stock unchanged and no order row. This passed on first run because the Node transaction already rolls back on a throw, so no transaction fix was needed.
- **Structural fix (ADR 0099):** the candidate's `commerceSchemaMigrations` re-export broke the boundary test, which allows the commerce façade to export only `createCommercePack`. The re-export is removed. The Durable Object takes its migrations from `createCommercePack(...).migrations`. The cutover flag moves from version 5 to version 6. This is safe because the commerce object was never deployed, so no live database has applied version 5 as the cutover.
- **Migration limit:** migration 5 aborts while any legacy `merchant_orders` row exists, because SQLite cannot compute SHA-256. Commerce orders are not live, so no production row is affected. A converter, if one is ever needed, is a separate decision.

ADR compliance for this slice:

| ADR | Constraint | Where it is applied |
| --- | --- | --- |
| Coding standards, bearer credentials (ADR 0075) | Store payment references only as a hash; never log, return or audit them | `hashPaymentReference`, `commerce-order.ts`; export projection, `do-export.ts` |
| ADR 0096 (exemption, shortlet columns only) | Unchanged; the commerce export holds a hash, not the raw reference | `do-export.ts` `PROJECTIONS.merchant_orders` |
| ADR 0100 and ADR 0001 | Verified merchant gate for orders and checkout | `commerce-order.ts` `#buildOrder` |
| ADR 0099 | The domain façade exports only `createCommercePack` | `domains/commerce/src/index.ts` |
| ADR 0101 | Commerce migrations and cutover belong to the commerce object | `commerce-market-do.ts`, `schema.ts` `commerceMigrationsWithCutover` |
| ADR 0095 | Synchronous SQL transactions with no network I/O | `createOrder` transaction |
