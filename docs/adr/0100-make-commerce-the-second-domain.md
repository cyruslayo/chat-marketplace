---
status: accepted
---

# Make commerce the second domain, with its own distribution channels and instastore as the specification

## Context

ADR 0003 built the product as an extensible Concierge Platform and moved marketplace commerce out of the launch, leaving shortlet booking as the first reference domain. A second domain is now re-admitted to exercise the platform seam that ADR 0099 defines: a domain pack must be able to plug into the platform without either domain reaching into the other.

The commerce domain already has a glossary (`domains/commerce/CONTEXT.md`) covering Merchant, Consumer, Store, Product, Merchant Offer, Marketplace Cart, Store Cart, Merchant Order, Seller of Record and Marketplace Commission. `cyruslayo/instastore` is a working e-commerce system on Supabase; its business rules are the reference for the commerce domain's behaviour, and it is a specification to port, not a dependency to keep.

Distribution is constrained by OpenAI's channel rules: its commerce support covers physical goods, so a services vertical such as stays does not qualify, while products do.

## Decision

1. **Commerce is the second domain pack, at `domains/commerce`.** It registers against the Concierge Platform through the `DomainPack` interface (ADR 0099) and never imports shortlet, and shortlet never imports commerce. The two domains share platform infrastructure only.

2. **One platform, several front doors.**
   - **Own app** (web/PWA, and WhatsApp later): hosts Stays and Shop under one concierge.
   - **ChatGPT app** (remote MCP server, slice 29): **commerce-only**, because OpenAI permits commerce for physical goods and services such as stays do not qualify. It links back to our checkout and order tracking.
   - **Merchant store links**: one store each, shared by merchants (for example on Instagram).

   This extends the launch channel set of ADR 0067 with ChatGPT, for commerce only. ADR 0067 remains the bound for the shortlet channels. The channel constraints follow the OpenAI guidelines, [plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines) and [app submission guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines).

3. **instastore is the specification, not a dependency.** Port its business rules, edge cases, merchant-admin UX and onboarding documents into `domains/commerce`, then freeze instastore; `domains/commerce` becomes the source of truth. The rules that must survive the port include the store-order rules in [cyruslayo/instastore](https://github.com/cyruslayo/instastore) `supabase/migrations/0017_payment_verification_fact.sql` (`create_store_order`, `set_order_status`) and `supabase/migrations/0011_trusted_delivery_checkout.sql` (`get_order_status`).

4. **Product identity.** A `Product` is the shared identity and descriptive facts of an item, independent of seller (`domains/commerce/CONTEXT.md`), and a Merchant Offer is a store-specific purchasable proposition for a product. At MVP a product carries one Merchant Offer: no cross-store de-duplication or merging. The MVP rule is a policy, not a schema limit; the model already separates product from offer.

5. **Merchant onboarding is operator-assisted first.** Onboarding follows instastore's `docs/MERCHANT_ONBOARDING.md` and is run by platform operators, not self-service. Self-service signup is later work.

6. **Merchants are verified before their stores appear to the agent.** Consistent with ADR 0001, a store is only surfaced by the concierge when it is active and its merchant is verified. Unverified stores are not offered to a Consumer.

7. **`CONTEXT-MAP.md` records commerce as an active domain** once this ADR is accepted.

## Consequences

- The platform seam (ADR 0099) is exercised by a real second domain, which is ADR 0003's condition for trusting the platform's abstractions.
- The commerce slices (18 onward) can be built against `domains/commerce` and the platform interface; the payments structure is decided separately (slice 04) and hosting separately (slice 05).
- A new front door (ChatGPT, commerce-only) is added, with its own submission review (slice 28) and MCP server (slice 29).
- Shortlet behaviour is unchanged by this decision.

## Related

ADR 0001 (merchants are sellers of record), ADR 0003 (extensible concierge platform, first domain, second-domain gate), ADR 0067 (launch channels; extended here with ChatGPT for commerce), ADR 0099 (domain-pack interface and module boundaries). PRD and map: `.scratch/multi-domain-platform/`. Reference material: `domains/commerce/CONTEXT.md`, `cyruslayo/instastore`.
