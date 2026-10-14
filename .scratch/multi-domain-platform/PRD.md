# PRD: Multi-domain Concierge Platform (shortlets + commerce)

Status: needs-triage
Requested: 14 Oct 2026
Map: `map.md`

## Problem

The repository is set up for several domains (ADR 0003, `CONTEXT-MAP.md`, `domains/commerce/CONTEXT.md`), but the code only works for shortlet booking. The agent, the chat UI, payments, accounts and Cloudflare hosting are all wired to shortlets.

We want a second vertical: **e-commerce for physical products sold by vetted Nigerian merchants**. One central concierge agent should handle both verticals, and more later. We also want a **ChatGPT app** for the commerce vertical.

## Decisions taken in planning (to be confirmed as ADRs, slices 01, 03, 04, 05)

1. **One platform, several front doors.**

   | Front door | Verticals | Why |
   | --- | --- | --- |
   | Own app (web/PWA, later WhatsApp) | Stays + Shop, one concierge | We own the brand, the account and the payment relationship. |
   | ChatGPT app (remote MCP server) | Shop only | OpenAI allows commerce **only for physical goods**; services such as stays don't qualify. The app links back to our checkout and tracking. |
   | Merchant store links | One store | Merchants share them on Instagram. |

   Sources: [OpenAI plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines), [App submission guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines).

2. **Cloudflare is the only deployment platform.** Commerce runs on the same Worker, Durable Object (SQLite) and R2 stack as shortlets (ADR 0095).

3. **instastore is the specification, not a dependency.** [cyruslayo/instastore](https://github.com/cyruslayo/instastore) runs on Supabase (Postgres, RLS, Auth, Storage). Its business rules live in plpgsql:
   - `supabase/migrations/0017_payment_verification_fact.sql`: `create_store_order`, `set_order_status`
   - `0011_trusted_delivery_checkout.sql`: `get_order_status`

   Its TypeScript (`src/lib`, about 1,100 lines) is mostly Supabase calls. We port its **rules, edge cases, merchant-admin UX and onboarding docs** into `domains/commerce`, then freeze it.

4. **The design follows *A Philosophy of Software Design* (Ousterhout):** a few deep modules with small interfaces, information hidden behind them, and complexity pulled down into the platform.

## Diagnosis: the codebase today

Measured on `main` at 9a24178.

| # | Red flag | Evidence | Effect |
| --- | --- | --- | --- |
| 1 | Shallow module, information leakage | `domains/shortlet`: 73 files, 22.6k lines, **798 exports**. `src/index.ts` is a list of `export *` lines. **74** non-test files in `apps/` import from `domains/shortlet/src`, and **41** internal modules are imported directly past `index` (e.g. `sqlite-unit-repository`, `booking-state`, `guest-interaction-store`). | The interface *is* the implementation. Internal changes break apps. |
| 2 | Pass-through layer | 19 `*Application` classes in `apps/web/src`. **17 expose `readonly manager`**, and there are **112 `.manager.` reach-throughs** in `apps/`. Example: `CardPaymentApplication.getArtifact` calls `conditionalOfferApplication.manager.getOffer`. Its options interface repeats `CardPaymentManagerOptions` field by field. | Callers must learn the wrapper *and* the manager. |
| 3 | Repetition instead of pulling complexity down | The action gate (context allow-list, artifact kind/version, stale projection, authorization, rejection codes) is written separately in the 15 `apps/web/src/*-actions.ts` files. The stale-action check appears in 7 more application/adapter files (22 total). `contextOf` is copied 8 times. | A security rule (ADR 0072, 0074) exists in 22 copies. |
| 4 | Split by layer, not by knowledge | One workflow spans the domain file, `*-application`, `*-actions`, `*-artifact`, `web-agent/*-a2ui`, `*-presentation`, `guest-server.ts` and `client.ts`. Card payment touches 34 non-test files, relocation 19, deposit claim 17. | Change amplification: commerce built this way would copy about 8 files per workflow. |
| 5 | Big but not deep | `apps/local-guest/src/guest-server.ts` is **9,601 lines**: 56 imports, 58 event constants, with routing, sessions, HTML and every feature's wiring. `client.ts` is 2,531 lines. | High cognitive load. |
| 6 | Special-purpose code in general-purpose modules | `packages/platform-core/src/surface.ts` hardcodes `APPROVED_CATALOGUES`. `human-handoff.ts` knows `activeStay` and `bookingId`. `apps/local-guest/src/assistant/assistant-tools.ts` (823 lines) mixes the generic tool loop with the shortlet prompt, Lagos neighbourhoods and stay tools. `assistant-runtime.ts` (903 lines) imports shortlet directly. | The platform can't host a second domain without editing it. |
| 7 | Platform services inside a domain | Paystack (`domains/shortlet/src/paystack.ts`), guest accounts (`guest-account-*.ts`), manual transfer, the receipt blob store. | Commerce would have to import shortlet. |

**Keep:**
- **Deep modules that already work:**
  - The `SqlDatabase` port (`packages/platform-core/src/sql-database.ts`) and the DO adapter (`apps/cloudflare/src/do-sql-database.ts`).
  - `GenerativeSurfaceManager`.
  - `CircuitBreaker` and `ProviderContractRegistry`.
  - `createPlatformCommandEnvelope`.
- **The split between presentation and rendering** (`apps/web-agent/src/*-presentation.ts` → `*-a2ui.ts`). It is the seam for two renderers (Weaver now, ChatGPT widgets later).
- **The ADR practice.**

## Target design

```
Hosts (composition roots only): apps/cloudflare (Worker + DOs) · apps/pilot (node) · MCP server (later)
                                  │ register packs
Concierge Platform (deep): Conversation (threads + tasks, router) · Agent (model clients, tool loop,
  budget, active-pack tools only) · Interactions (ONE action gate) · Surfaces (registry-fed catalogues,
  renderers) · Payments (start / confirm / webhook) · Accounts · Handoff · Audit · Telemetry ·
  Redaction · Storage ports (SqlDatabase, BlobStore)
                                  │ DomainPack (the only seam)
            domains/shortlet (façade + hidden internals)   domains/commerce (façade + hidden internals)
```

Sketch only. Slice 02 fixes the real interface.

```ts
interface DomainPack {
  id: string;
  catalogues: CatalogueDefinition[];            // ADR 0073
  migrations: Migration[];                       // on SqlDatabase
  agent: {
    promptSection: string;
    tools(task: TaskState): ToolDefinition[];
    execute(call: ToolCall, ctx: DomainContext): Promise<ToolResult>;
  };
  surfaces: { project(task: TaskRef, viewer: Principal): Presentation };
  actions: ActionSpec[];
  routes?: RouteModule;
  onEvent?(event: PlatformEvent): void;
}
interface ActionSpec {
  name: string; artifactKind: string; schemaVersion: number;
  context: ContextSchema;
  isStale(current: Presentation, ctx: ActionContext): boolean;
  run(command: PlatformCommand, ctx: DomainContext): ActionResult;
}
```

Rules:
- **Each domain exposes one façade from `index.ts`.** No imports past it; a boundary test enforces this.
- **Organize by knowledge:** a workflow's rules, projection and action specs live together inside its pack.
- **Thin hosts:** `guest-server.ts` becomes a shell that composes pack route modules.
- **Platform Payments** owns Paystack, webhooks, transfer verification, receipts and idempotency. Domain ledgers react to its events.
- **Platform Accounts** owns sign-in by email code (ADR 0093). Identity assurance (Smile ID) stays with shortlet.
- **Cloudflare:** one Worker; a platform DO for accounts, conversations and tasks; one DO class per domain (`ShortletPilot`, `CommerceMarket`); R2 for receipts and product images.

## Chat UX model

- **Layout:** one shell with a **task rail**. A task is one flow in one domain:
  - Stays: Search → Request → Offer → Pay → Confirmed.
  - Shop: Browse → Store cart → Delivery → Pay → Track.
- **Router:** an explicit chip or the active task wins; the model classifies only when those don't decide. It never switches flows silently: "Start a Shop search? Your stay search is saved."
- **Tool exposure:** the model sees only the active pack's tools plus `start_task`/`switch_task`. A call to another pack's tool fails closed.
- **Async events:** an offer arriving or an order shipping goes to its own task as a rail badge and notification, never into the open conversation.
- **Shared surfaces** (`platform-common`): payment step, status timeline, handoff, confirmation.
- **Pack catalogues:** `shortlet-*` (existing) and `commerce-discovery/v1`, `commerce-cart/v1`, `commerce-order/v1` (ADR 0073 review).
- **Trust badges differ per vertical:** "Inspected" for stays, "Verified merchant" for shops.

## instastore → commerce mapping

| instastore | `domains/commerce/CONTEXT.md` | Action |
| --- | --- | --- |
| `stores` (active/suspended) | Store | Port; add verification gating (ADR 0001). |
| `profiles` role=admin | **Merchant** (missing) | New. Verified business (CAC, bank account in the business name). One merchant, many stores. |
| `store_settings` (branding, bank details, NGN) | Store settings | Port branding. Bank details become a Paystack subaccount (slice 04). |
| `products` (price, compare-at, stock, 4 images) | Product + Merchant Offer | MVP: one offer per product; price and stock on the offer; images in R2. |
| none (instastore T14 deferred) | Offer variants | New (size, colour). |
| Client cart (nanostores) | Marketplace Cart → Store Carts | New, server-side, per task. |
| `orders` (JSONB items, one store) | Merchant Order | Port `create_store_order` rules to TypeScript. One store per order matches ADR 0002. |
| `delivery_zones` | Fulfilment terms / delivery quote | Port. |
| `src/lib/orderWorkflow.ts` | Merchant Order lifecycle | Port. |
| Receipt upload + manual verification | Payment | Platform Payments: Paystack primary, manual transfer per the ADR 0090 pattern, R2 receipts. |
| Guest checkout by phone | Consumer | Platform Accounts. |
| `/admin` (orders, products, delivery, content) | Merchant back office | Rebuild following `apps/local-owner`. |
| `/s/<slug>` storefront | Store page | Rebuild with the guest kit, from the same presentation helpers as chat. |
| Analytics/consent, Meta stub | none | Out of scope. |

**Rules from instastore that must survive the port** (from `create_store_order` in `0017`):
- The store must be active.
- The delivery zone must exist, be active and belong to the store.
- Customer name, phone (normalized, at least 7 digits) and shipping address are required.
- At least one item.
- Prices and subtotal are recomputed server-side; the submitted total is never trusted.
- Stock is checked and decremented atomically.
- Retries are idempotent on the payment reference.
- Status transitions follow `set_order_status`; the first move to Processing records `payment_verified_at` once.

## Metrics (track in `map.md`)

| Metric | Today | Target |
| --- | --- | --- |
| Shortlet public exports | 798 | < 50 |
| `.manager.` reach-throughs in apps | 112 | 0 |
| Deep imports past `domains/*/src/index` | 41 modules | 0 |
| Action-gate copies | 22 files | 0 (one platform gate) |
| `guest-server.ts` lines | 9,601 | shell only |

## Out of scope

- Cross-vertical bundles (e.g. "deliver to my stay"). Revisit after both verticals launch.
- Publishing the SDK outside this repo (ADR 0003).
- Merchant self-service signup. Onboarding is operator-assisted first, as in instastore's `docs/MERCHANT_ONBOARDING.md`.
- Logistics APIs, coupons, analytics pixels.

## Open questions

- **Paystack:** written confirmation of the marketplace split structure, and Nigerian legal review (ADR 0002 conditions). Slice 04.
- **Product identity:** one Product shared by many stores, or one offer per product for the MVP? Slice 02/03.
- **Which vertical launches first?** Shortlet pilot readiness versus merchant demand. The owner decides.
