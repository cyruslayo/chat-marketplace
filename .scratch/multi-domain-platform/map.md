# Map: Multi-domain Concierge Platform

PRD: `PRD.md`. It explains why: the distribution decision, the *A Philosophy of Software Design* diagnosis with measured evidence, the target design, the instastore → commerce mapping and the chat UX model.

## Slice rules

Each slice:

- **Fits one agent session.** A bounded list of files and five acceptance criteria or fewer.
- **Leaves the repo green.** `npm run check` and `npm test` pass. The browser phase takes about 12 minutes, so run it in the background.
- **Lane B keeps shortlet behaviour unchanged.** The existing tests, the guest walkthrough and `capture-11-all.sh` must show no change. If a slice can't stay neutral, stop and write the reason in `## Comments`.
- **Builds commerce (lane D) only through the `DomainPack` interface.** If commerce needs to get around the interface, the interface is wrong. Reopen slice 02 and don't add a workaround.
- **Stays inside its "Out of scope" list.** If the work spills over, note it in `## Comments` instead of growing the slice.

Cross-effort blockers name the effort, for example `weaver-catalogues 03`.

## Lanes

| Lane | What | Parallel? |
| --- | --- | --- |
| A: Decisions | ADRs and the interface design | 01 and 03 can start now |
| B: Deep modules | Refactor shortlet behind the platform. Behaviour must not change. | 06 can start now; 07 and 11 can run in parallel after 02 |
| C: Platform services | Payments, Accounts, Cloudflare platform Durable Object | after B |
| D: Commerce | Commerce domain pack, built from the instastore specification | after 03 and 12 |
| E: Concierge UX | Task rail, store pages | after 13 and 23 |
| F: ChatGPT | MCP server for commerce | last |

## Workflow

The frontier is the first slice in the table that is open, unblocked and unclaimed. Agents can take the frontiers of different lanes at the same time.

1. Claim the slice: set `Status: claimed` in the issue and in this table.
2. Follow the AGENTS.md implementation protocol: read the ADRs, then write one failing test per acceptance criterion.
3. Implement, then run `npm run check` and `npm test`. For `apps/cloudflare` slices, also run its Workers tests.
4. Check the Definition of Done in `docs/agents/issue-tracker.md` item by item.
5. Commit on a branch named `mdp/<NN>-<slug>` and open one PR per slice.
6. Write `## Answer`, set `Status: resolved`, and add a context pointer below.

`ready-for-human` slices (ADRs) can be drafted by an agent, but only the owner accepts them. A slice that depends on an ADR waits until that ADR is accepted.

## Slices

| # | Slice | Type | Status | Blocked by | Unlocks |
| --- | --- | --- | --- | --- | --- |
| **A: Decisions** | | | | | |
| 01 | [ADR draft: domain pack interface and module boundaries](issues/01-adr-domain-pack-interface-and-module-boundaries.md) | grilling | ready-for-human | none | 02, 05 |
| 02 | [Design it twice: walk shortlet and commerce flows through DomainPack and ActionSpec](issues/02-design-the-domain-pack-interface-twice.md) | research | ready-for-agent | 01 | 07, 11 |
| 03 | [ADR draft: commerce as the second domain, distribution channels, instastore as specification](issues/03-adr-commerce-domain-and-distribution.md) | grilling | ready-for-human | none | 04, 18, 28 |
| 04 | [ADR draft: commerce payments on Paystack split per store (supersedes 0002)](issues/04-adr-commerce-payments-paystack-split.md) | grilling | needs-info | 03 | 22 |
| 05 | [ADR draft: multi-domain Cloudflare hosting (amends 0095) and platform accounts (amends 0093)](issues/05-adr-multi-domain-hosting-and-platform-accounts.md) | grilling | ready-for-human | 01 | 16, 17 |
| **B: Deep modules** | | | | | |
| 06 | [Boundary test: no imports past domains/*/src/index](issues/06-boundary-test-for-domain-imports.md) | task | ready-for-agent | none | 10 |
| 07 | [Platform Interactions gate and ActionSpec; convert card-payment and bank-transfer actions](issues/07-platform-interactions-action-gate.md) | task | ready-for-agent | 02 | 08a, 08b, 14a |
| 08a | [Convert booking-funnel actions to ActionSpec](issues/08a-convert-booking-funnel-actions.md) | task | ready-for-agent | 07 | 09a |
| 08b | [Convert stay-support actions to ActionSpec](issues/08b-convert-stay-support-actions.md) | task | ready-for-agent | 07 | 09b |
| 09a | [Shortlet façade, payments group: fold Application pass-throughs, remove readonly manager](issues/09a-shortlet-facade-payments-group.md) | task | ready-for-agent | 08a | 09b, 15 |
| 09b | [Shortlet façade, remaining applications; .manager. reach-throughs to zero](issues/09b-shortlet-facade-remaining-applications.md) | task | ready-for-agent | 09a, 08b | 10 |
| 10 | [Shrink domains/shortlet/src/index.ts to the façade; empty the boundary allow-list](issues/10-shrink-shortlet-public-interface.md) | task | ready-for-agent | 09b, 06 | 16 |
| 11 | [Registry-fed catalogues; domain-supplied handoff and interaction-security fields](issues/11-registry-fed-catalogues-and-handoff-fields.md) | task | ready-for-agent | 02 | 12 |
| 12 | [Agent DomainPack registry: shortlet prompt and tools move into the pack](issues/12-agent-domain-pack-registry.md) | task | ready-for-agent | 11 | 13, 18 |
| 13 | [Conversation tasks and router: one domain per task, no silent switching](issues/13-conversation-tasks-and-router.md) | task | ready-for-agent | 12 | 17, 23, 26 |
| 14a | [Split guest-server.ts: generic shell (sessions, conversation and action endpoints, assets)](issues/14a-split-guest-server-shell.md) | task | ready-for-agent | 07 | 14b |
| 14b | [Shortlet route module composed by the shell](issues/14b-shortlet-route-module.md) | task | ready-for-agent | 14a | 27 |
| **C: Platform services** | | | | | |
| 15 | [Platform Payments: move the Paystack port, webhook, transfer verification and receipt store out of shortlet](issues/15-platform-payments-module.md) | task | ready-for-agent | 09a | 22 |
| 16 | [Platform Accounts: move guest accounts and sign-in by emailed code out of shortlet](issues/16-platform-accounts-module.md) | task | ready-for-agent | 05, 10 | 17 |
| 17 | [Cloudflare platform Durable Object (accounts, conversations) and Worker routing by domain](issues/17-cloudflare-platform-do-and-domain-routing.md) | task | ready-for-agent | 05, 13, 16 | 24 |
| **D: Commerce** | | | | | |
| 18 | [Commerce pack scaffold: registration, migrations, Merchant and Store with verification gating](issues/18-commerce-pack-scaffold-merchant-store.md) | task | ready-for-agent | 03, 12 | 19 |
| 19 | [Commerce catalogue: Product, Merchant Offer, Variant, delivery zones, R2 images, search](issues/19-commerce-catalogue-offers-variants-delivery.md) | task | ready-for-agent | 18 | 20, 25a |
| 20 | [Marketplace Cart and Store Carts, server-side per task](issues/20-commerce-marketplace-and-store-carts.md) | task | ready-for-agent | 19 | 21 |
| 21 | [Merchant Order: port instastore order rules and lifecycle](issues/21-commerce-merchant-order-rules.md) | task | ready-for-agent | 20 | 22, 23, 24, 25b |
| 22 | [Commerce checkout through platform Payments (Paystack split and manual transfer)](issues/22-commerce-checkout-through-platform-payments.md) | task | ready-for-agent | 04, 15, 21 | 23 |
| 23 | [Commerce agent tools, commerce-* catalogues and presentations](issues/23-commerce-agent-tools-and-catalogues.md) | task | ready-for-agent | 13, 21, weaver-catalogues 03 | 27, 29 |
| 24 | [CommerceMarket Durable Object and routing](issues/24-commerce-durable-object-and-routing.md) | task | ready-for-agent | 17, 21 | 29 |
| 25a | [Merchant back office: onboarding and catalogue management](issues/25a-merchant-back-office-onboarding-and-catalogue.md) | task | ready-for-agent | 19 | 25b |
| 25b | [Merchant back office: delivery zones and order fulfilment](issues/25b-merchant-back-office-delivery-and-orders.md) | task | ready-for-agent | 25a, 21 | none |
| **E: Concierge UX** | | | | | |
| 26 | [Shell task rail, vertical starters, domain chips; events routed to their task](issues/26-shell-task-rail-and-vertical-starters.md) | task | ready-for-agent | 13 | 27 |
| 27 | [Store page and order tracking page from the same presentation helpers as chat](issues/27-store-page-and-order-tracking.md) | task | ready-for-agent | 23, 14b | none |
| **F: ChatGPT** | | | | | |
| 28 | [Research: ChatGPT app submission for commerce (link-out checkout, Nigeria, review checklist)](issues/28-research-chatgpt-commerce-submission.md) | research | ready-for-agent | 03 | 29 |
| 29 | [Commerce MCP server on Cloudflare: read tools, checkout link-out, widgets from presentations](issues/29-commerce-mcp-server-on-cloudflare.md) | task | ready-for-agent | 23, 24, 28 | none |

## Metrics

Update these when a slice changes them.

| Metric | Baseline (9a24178) | Target | Current |
| --- | --- | --- | --- |
| Shortlet public exports | 798 | < 50 | 798 |
| `.manager.` reach-throughs in `apps/` (non-test) | 112 | 0 | 112 |
| Modules imported past `domains/*/src/index` | 41 | 0 | 41 |
| Files with an action-gate copy | 22 | 0 | 22 |
| `apps/local-guest/src/guest-server.ts` lines | 9,601 | < 1,000 | 9,601 |

## Context pointers (resolved slices)

None yet.
