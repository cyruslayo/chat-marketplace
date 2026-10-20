# CommerceMarket Durable Object and routing

Status: resolved
Type: task
Blocked by: 17, 21
Requested: 14 Oct 2026
Unlocks: 29
Lane: D: Commerce
PRD: `../PRD.md`

## Why

Commerce transactions need their own DO per slice 05.

## What to build

Add the SQLite-backed `CommerceMarket` Durable Object in `apps/cloudflare`. Give it the commerce migration ledger, typed internal clients, import/export paths, and commerce-owned alarms. Keep the commerce schema and transaction state inside that object.

The 19 Oct user decisions narrow this issue's routing and image scope. Public commerce API paths return 404. Order creation uses the internal/restore paths. Internal checkout validates the server-side quote and returns `409 payment_unavailable` without writing an order or reserving stock until issue 22. Product image upload through the DO belongs to the merchant back-office work; `R2ProductImageStore` remains a tested unit without a caller. Shortlet receipt handling stays with Shortlet.

## Out of scope

- Merchant back office hosting decisions beyond routing.

## Acceptance criteria

- AC1: Commerce tables and transactions live only in the commerce DO; its imports, tenant checks, exports, and retention sweeps stay commerce-scoped.
- AC2: Workers tests cover internal and restore order paths. Valid internal checkout returns `409 payment_unavailable`, creates no order, and reserves no stock. Public commerce API paths return 404.
- AC3: Shortlet Workers tests continue to pass. Additive fixture and test configuration changes are allowed; existing assertions must not be weakened.

## Tests

Workers Vitest additions.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0001-merchants-are-sellers-of-record.md` | The order belongs to one merchant and its store. |
| `docs/adr/0004-web-and-backend-own-authoritative-state.md` | The DO is the transaction authority. |
| `docs/adr/0075-secure-and-minimize-agent-interaction-data.md` | Payment references and personal data need restricted handling. |
| `docs/adr/0095-host-the-pilot-on-cloudflare.md` | As amended by slice 05. |
| `docs/adr/0096-export-payment-references-in-plaintext.md` | Its plaintext exception applies only to named Shortlet export columns. |
| `docs/adr/0099-define-the-domain-pack-interface-and-module-boundaries.md` | Commerce owns its façade, migrations, ledger, and transaction model. |
| `docs/adr/0100-make-commerce-the-second-domain.md` | Commerce stays independent from Shortlet; verified merchants gate orders. |
| `docs/adr/0101-multi-domain-cloudflare-hosting-and-platform-accounts.md` | Each domain has its own DO; commerce R2 objects stay private and opaque-keyed. |
| `docs/adr/0103-adopt-commerce-discovery-cart-and-order-catalogues.md` | Issue 23 checkout stays unavailable until payment is connected; no order is created. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Answer

Implemented `CommerceMarket` as the commerce-owned SQLite authority, with migrations, typed internal clients, scoped import/export and commerce-owned alarms. Public commerce API paths and private `/_internal` paths are refused by the Worker before tenant provisioning or authority lookup, including when the tenant binding is absent, empty or whitespace (`e77e03a`). Ordinary unprovisioned Shortlet paths retain their 503 response.

Order creation runs directly against the commerce object's database in Workers tests and through restore/retry. There is no internal HTTP order-create route. Internal checkout validates a server-side quote and returns `409 payment_unavailable` without order or stock writes. ADR 0103 governs this unavailable-checkout boundary, not the order-creation rules. Commerce stores and exports only keyed payment-reference hashes (ADR 0075/0096); its tables and transactions remain separate from platform and Shortlet (ADR 0099/0100/0101).

Product-image upload through the DO remains deferred by the 19 Oct user decisions. `R2ProductImageStore` is a tested unit without a caller. No order-upgrade converter or Worker previous-key rotation was added; do not rotate the key until `previousKeys` is wired. Payment collection remains issue 22, blocked on slice 04. No issue 29 work is authorized by this closeout.

### Acceptance evidence

| Criterion | Named test evidence | State |
| --- | --- | --- |
| AC1: commerce tables and transactions stay in CommerceMarket. | `apps/cloudflare/test/commerce-market.spec.ts`: `24 AC1: commerce data lives only in the commerce DO after order traffic, disjoint from platform and shortlet`; tenant failures, import/export and cutover have separate named cases. `apps/cloudflare/test/export-owner-sweep.spec.ts`: `F9` owner and failure-sweep cases. | Passed in both final Workers runs. |
| AC2: Workers order/restore paths, unavailable checkout without writes, public API 404. | `commerce-market.spec.ts` AC1 directly calls `CommerceOrders.createOrder` through `runInDurableObject` using the commerce object's SQL storage. Its dedicated `24 AC2: internal checkout with a server-matching total returns 409 payment_unavailable and writes no order and reserves no stock` test checks checkout; bad total, wrong tenant, unverified merchant and public 404 have separate cases. `restore-from-export.spec.ts`: `16 restore: a day's export loaded parent-first into a new object exports the same bytes for every exported table` restores a Merchant Order and retries `createOrder` by its keyed hash. `platform-routing.spec.ts`: `24 AC2: public commerce API paths return 404 without tenant provisioning (%j)` covers absent/empty/whitespace bindings. Node domain AC1–AC5 tests in `test/commerce-order.test.ts` are supplemental, not Workers evidence. | Passed in both final Workers runs. |
| AC3: Shortlet behavior retained without weakened assertions. | `commerce-market.spec.ts`: `24 AC3: Shortlet Worker paths retain their routing and unprovisioned response`; `platform-routing.spec.ts`: `24 AC3: unprovisioned Shortlet paths retain 503 (%j)`. Existing Shortlet/restore assertions are retained alongside additive commerce fixtures. | Both Workers runs and all 34 browser files passed. |

### Definition of Done — checked at closeout

| Item | Evidence | State |
| --- | --- | --- |
| 1. One named test per acceptance criterion. | AC1–AC3 cases above. | Passed. |
| 2. Named failure paths. | Foreign tenant, unexpected keys, malformed checkout, unavailable payment, bad total, unverified merchant, public route refusal, schema/hash errors and cutover refusal; absent/empty/whitespace provisioning regressions. | Passed. |
| 3. Relevant ADRs listed and read. | ADRs 0001, 0004, 0075, 0095, 0096, 0099, 0100, 0101 and 0103; constraints mapped above and in the implementation/review records below. | Verified. |
| 4. No unused injected dependency. | Commerce database, export bucket, configuration and pack are used by the implementation. | Final standards review found no blocker. |
| 5. No invented policy value. | HMAC, image limits, retention, public-code and phone decisions trace to recorded user decisions, ADRs or existing configuration. | Verified; image upload and payment policy remain outside this slice. |
| 6. No restricted credential in logs or audit. | Fixed startup codes, keyed-hash tests, export projection and import validation. | Tests passed; final review found no blocker. |
| 7. Type check and full suite pass. | Tested code commit `e77e03a64d4564d727d1b0a6c6a3f84c12c6ba95`; complete results below. | Passed; user-approved local `main` integration completed. |

### Final validation and integration

All final gates below ran against code commit `e77e03a64d4564d727d1b0a6c6a3f84c12c6ba95` in `C:\AI2026\worktrees\mdp-24-commerce-do`. Heavy suites ran serially after machine-wide runner checks. Log paths are relative to `%TEMP%\opencode\`; each gate has a matching `.metadata.json` with command, SHA and timestamps, plus an `.exit.txt` recording `EXIT=0`.

| Gate | Result | Raw log and exit sidecar |
| --- | --- | --- |
| `npm run check` | All TypeScript checks and the Worker bundle guard passed, exit 0. | `mdp24-routing-final-check.log`, `mdp24-routing-final-check.exit.txt` |
| `NODE_ENV=test npm test` | Phase 1: 263 files, 1,980/1,980 passed. Phase 2: 34/34 browser files passed; 183 tests, 181 passed, 2 skipped, 0 failed or timed out. Exit 0; no `not ok` or missing-summary lines. | `mdp24-routing-fullsuite.log`, `mdp24-routing-fullsuite.exit.txt` |
| `npm run test:workers` run 1 | 23 files, 159 tests passed, exit 0. | `mdp24-routing-workers-1.log`, `mdp24-routing-workers-1.exit.txt` |
| `npm run test:workers` run 2 | 23 files, 159 tests passed, exit 0. | `mdp24-routing-workers-2.log`, `mdp24-routing-workers-2.exit.txt` |

Workers are not part of `npm test`; both separate runs above are required evidence. Earlier incomplete runs and the historical daily-export timeout do not replace these final passes.

Independent GPT-6 Luna medium standards/spec reviews are in `mdp24-final-standards.jsonl` and `mdp24-final-spec.jsonl`. Standards found no blocker; the sole spec blocker was the unprovisioned 503-vs-404 routing order. It was fixed test-first in `e77e03a`: six expected red failures, then 10/10 focused tests passed. The independent follow-up in `mdp24-routing-review.jsonl` explicitly closed that blocker and found no remaining standards/spec blocker. Review exit sidecars record 0. The evidence mappings for issue 21 ADR 0103 and this issue's order/checkout/restore paths were checked; Node tests are not presented as Workers tests.

The user approved the fast-forward of local `main` from `8d13cf0` to `e77e03a` and subsequently requested closing issues 21 and 24. Integration evidence is `mdp24-approved-fast-forward.log` and `mdp24-approved-fast-forward-preservation.json`. All 312 pre-existing canonical dirty files and both feature-worktree documentation drafts were verified unchanged by integration. Test-generated artifacts were restored: all 1,176 artifact hashes matched the baseline (`mdp24-routing-restoration.json`). This closeout is documentation-only; no application code changed after the tested commit. Nothing was pushed or deployed.

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
- **Structural fix (ADR 0099), corrected in review:** the candidate re-exported `commerceSchemaMigrations`, which broke the boundary test (AC4). The façade now exports `createCommercePack`, `parseCreateOrderInput` and the `CreateOrderInput` type, the parser and type hosts need for untrusted checkout bodies. The Durable Object takes migrations from `createCommercePack(...).migrations`. The cutover flag moves from version 5 to version 6. This is safe only because the commerce object was never deployed. The boundary allow-list was not extended. Earlier text in this comment that said the façade exports only `createCommercePack` was wrong.
- **Migration limit:** migration 6 aborts while any legacy `merchant_orders` row exists, because SQLite cannot compute SHA-256. Commerce orders are not live, so no production row is affected. A converter, if one is ever needed, is a separate decision.

ADR compliance for this slice:

| ADR | Constraint | Where it is applied |
| --- | --- | --- |
| Coding standards, bearer credentials (ADR 0075) | Store payment references only as a hash; never log, return or audit them | `hashPaymentReference`, `commerce-order.ts`; export projection, `do-export.ts` |
| ADR 0096 (exemption, shortlet columns only) | Unchanged; the commerce export holds a hash, not the raw reference | `do-export.ts` `PROJECTIONS.merchant_orders` |
| ADR 0100 and ADR 0001 | Verified merchant gate for orders and checkout | `commerce-order.ts` `#buildOrder` |
| ADR 0099 | The domain façade exports only its pack factory and the checkout parser and type | `domains/commerce/src/index.ts` |
| ADR 0101 | Commerce migrations and cutover belong to the commerce object | `commerce-market-do.ts`, `schema.ts` `commerceMigrationsWithCutover` |
| ADR 0095 | Synchronous SQL transactions with no network I/O | `createOrder` transaction |

### Review corrections, 18 Oct 2026

The independent review (CHANGES REQUIRED) found that `test/domain-boundary.test.ts` AC4 failed on 530f9ae because the DO deep-imported `domains/commerce/src/order.js`. The earlier report of that test as green was wrong. The corrections:

1. **Façade (ADR 0099, BLOCKER):** `domains/commerce/src/index.ts` exports `createCommercePack`, `parseCreateOrderInput` and the `CreateOrderInput` type. The DO and the restore spec import them from the façade. The boundary allow-list was not extended.
2. **Shape after migrations:** the DO asserts that `merchant_orders` has `payment_reference_hash` and no `payment_reference` (`assertMerchantOrdersShape`, `commerce-schema-guard.ts`). A mismatch fails closed with `COMMERCE_SCHEMA_SHAPE_INVALID`. Tests: `test/commerce-schema-guard.test.ts`.
3. **Ledger is the source of truth:** `CommerceOrders` no longer runs the `merchant_orders` DDL. Only the migration ledger creates the table. Tests apply migrations through `test/helpers/commerce-database.ts`. Test: `issue 24 review 3` in `test/commerce-order.test.ts`. The other pack constructors still run their own `IF NOT EXISTS` DDL for their tables, which matches the ledger. That is a follow-up, not part of this slice.
4. **Local Node databases:** no Node path runs commerce migrations. Local SQLite files with the main-era `merchant_orders` must be reset. A fresh local file gets no `merchant_orders` table until a Node migration path exists. Both points are in `docs/runbooks/commerce-migration-failure.md`, section 3. This is an open decision for the coordinator, not a silent fallback.
5. **Migration failure:** the DO catches a failed start, logs only `COMMERCE_MIGRATION_FAILED` (or `COMMERCE_SCHEMA_SHAPE_INVALID`), and answers every request with 503 and that code. Runbook: `docs/runbooks/commerce-migration-failure.md`.
6. **Shortlet independent of Commerce:** `commerceMigrationClient` is lazy. The tenant check and the binding lookup happen per call, so building it cannot throw. `/_ops/status` and `/_ops/import/verify` report `commerce: { ok: false, code: "COMMERCE_UNAVAILABLE" }` instead of failing. `/_ops/cutover/complete` still needs commerce and fails closed with `COMMERCE_CUTOVER_UNAVAILABLE`, recording no Shortlet cutover. Tests: `apps/cloudflare/test/shortlet-ops-commerce-isolation.spec.ts`.
7. **Decision 9:** the `PRODUCT_IMAGES` binding is removed from `cloudflare.config.ts`, `cloudflare-config.ts`, `env.d.ts` and `wrangler.test.jsonc`. `r2-product-image-store.ts` is a tested unit (node test) with the decision-8 signature check. It has no production caller until the merchant back-office issue. The Workers image test was removed.
8. **Policy sources:** the 5 MiB limit and the JPEG, PNG and WebP list come from the user's decision of 18 Oct 2026, under "Implementation decisions, 18 Oct 2026" above (decisions 8 and 9), and the constants cite it. **The 7-digit minimum is a user decision (19 Oct 2026):** kept, and recorded in `domains/commerce/CONTEXT.md`. It is enforced by `#requirePhone` in `commerce-order.ts`.
9. **Shared fixtures:** the JPEG, PNG and WebP bytes are in `test/helpers/product-image-fixtures.ts`. The Workers multi-criterion ops test is split into one test per criterion in `commerce-market.spec.ts`.
10. **Hash format on import:** a `merchant_orders` import row must carry a 64-character lowercase hex `payment_reference_hash`, or the DO refuses it with `INVALID_PAYMENT_REFERENCE_HASH` before any write (`assertPaymentReferenceHashes`). Tests: `test/commerce-schema-guard.test.ts` and `commerce-market.spec.ts`.

Superseded: the hash is now keyed (see "Keyed payment reference hash" below).

**Issue 27 collision (migration 5):** `mdp/27-store-and-tracking` (94c7eec) also adds commerce migration 5, a `merchant_order_tracking_attempts` table with an FK to `merchant_orders.public_code`, and it changes the idempotency check and `normalizePhone`. Issue 27 merges first. After that, this branch merges main, renumbers the hash rebuild to 6 and the cutover to 7, and rebuilds `merchant_orders` while keeping the tracking table and its FK. Tests derive versions from the migration list rather than hard-coding them.

### Keyed payment reference hash, 18 Oct 2026

User decision 18 (18 Oct 2026): payment references are hashed with a keyed HMAC-SHA-256, not a plain SHA-256. Reason: Shortlet references are predictable (`psp_ref_<4 random chars>_<timestamp>`, `domains/shortlet/src/card-payment.ts:322`), so a plain hash in the export could be brute-forced offline. The rule follows ADR 0075 (secrets and bearer credentials) and the coding-standards bearer-credential rule.

- **Format:** `merchant_orders.payment_reference_hash` stores `<keyId>:<64 lowercase hex>`, the HMAC-SHA-256 of the trimmed reference. The key id is stored in clear so a rotation can add a key without losing old orders.
- **Domain:** `domains/commerce/src/payment-reference.ts`. The keys are injected into `createCommercePack`; the domain never reads the environment. The pack throws at construction when the current key is missing, short (under 32 bytes) or has a malformed id. Lookup tries the current key and any configured previous keys (`previousKeys`).
- **Cloudflare:** the secret `COMMERCE_REFERENCE_HMAC_KEY` and the var `COMMERCE_REFERENCE_HMAC_KEY_ID` (declared in `cloudflare.config.ts`, `env.d.ts` and `cloudflare-config.ts`). The DO reads them before it builds the pack. A missing or short key fails closed with `COMMERCE_REFERENCE_KEY_INVALID`. The Workers test config uses a synthetic test-only key.
- **Node:** the local merchant reads the same variables from the environment and refuses to start without them. `test/helpers/commerce-database.ts` holds a fixed test-only key.
- **Restore:** the import check accepts only `<keyId>:<64 lowercase hex>`. A plain 64-hex value is refused.
- **Secret inventory:** `apps/cloudflare/.dev.vars.example`, `.env.example`, `docs/runbooks/cloudflare-staging-rehearsal.md` and `docs/runbooks/commerce-migration-failure.md` section 4.
- **Open:** the Worker reads only the current key. Rotation needs the previous-key wiring first (runbook section 4).

Tests: `test/commerce-reference-hash.test.ts` (same reference and key gives the same order; a different key gives a different hash; the stored value is `keyId:HMAC`; a missing or short key throws at construction; an order stored under a previous key is found after rotation; restore accepts the keyed format and refuses plain hex; the Worker key reader fails closed without echoing the key). The raw reference never appears in the database dump, which `test/commerce-order.test.ts` checks.

### User decisions, 19 Oct 2026

The user accepted these on 19 Oct 2026. Status is unchanged.

1. **AC2 re-scoped.** Order creation is covered through the CommerceMarket object's internal and restore path. Internal checkout returns `409 payment_unavailable` until issue 22. Product images moved to the merchant back-office work (decision 9).
2. **AC3 accepted.** The additive edits to `restore-from-export.spec.ts`, `ops-test-helpers.ts` and `wrangler.test.jsonc` count as "Shortlet Workers tests pass unchanged". Nothing existing was weakened.
3. **The 7-digit phone minimum is kept** as a user decision. It is recorded in `domains/commerce/CONTEXT.md`, next to the Nigerian Mobile Number rule.
4. **No order-upgrade converter.** Migration 6 refuses databases with orders, and the runbook reset applies (`docs/runbooks/commerce-migration-failure.md`).
5. **`R2ProductImageStore` stays a tested unit with no caller** until the back-office issue.
6. **Keyed-hash rotation in the Worker is a separate follow-up.** Do not rotate the key until it is wired.

### Harness integration checkpoint (20 Oct 2026; historical)

The reviewed browser-timeout harness commit `248cfbf` was merged into the feature branch by merge commit `06134baf`. `applyTestEnvDefaults(process.env)` remained in place. Shared defaults set `NODE_ENV=test` and `COMMERCE_REFERENCE_TEST_KEY=allow` only when callers have not set them.

The focused environment regression passed 4/4, the focused non-browser commerce suite passed 48/48, and `npm run check` passed on `06134baf`. Logs are `%TEMP%\opencode\codex-mdp24-06134ba-env.log`, `%TEMP%\opencode\codex-mdp24-06134ba-focused.log`, and `%TEMP%\opencode\codex-mdp24-06134ba-check.log`. Workers/full-suite gates, final review and approved integration were still pending at that checkpoint; the final acceptance and validation tables above supersede the draft's pending states.

### Resolution (20 Oct 2026)

The user requested closeout after the final green gates and approved integration. All seven Definition of Done items are checked above. The two preserved issue-document drafts are incorporated into the closeout; their order/checkout/restore evidence now explicitly distinguishes direct Workers DO creation from supplemental Node domain tests. Issue 22 remains blocked on slice 04 (`needs-info`). Issue 29 is not started, and Worker key rotation remains deferred. No application or policy changes were made during closeout.
