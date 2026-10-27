# Context Map

## Contexts

- [Concierge Platform](./packages/platform-core/CONTEXT.md) — supplies shared conversational, channel, payment, notification, audit, and human-handoff capabilities without owning domain transactions
- [Shortlet Booking](./domains/shortlet/CONTEXT.md) — the first reference domain, covering verified accommodation discovery, quoting, availability, and booking in Lagos and Abuja
- [Marketplace Commerce](./domains/commerce/CONTEXT.md) — a parked domain pack, off by default and enabled only by `COMMERCE_ENABLED=true` (ADR 0104), covering products, merchant offers, carts, and merchant orders

## Relationships

- **Shortlet Booking → Concierge Platform**: registers domain tools, workflows, policies, and UI components against platform extension points.
- **Marketplace Commerce → Concierge Platform**: registers against the same extension points without sharing shortlet business concepts.
- **Shortlet Booking ↔ Marketplace Commerce**: share infrastructure only; neither domain imports or generalizes the other's transactional model.
- **Channel adapters → Domain packs**: translate domain results into channel-appropriate surfaces while authoritative transaction state remains in backend domain services.
