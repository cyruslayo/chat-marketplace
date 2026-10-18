---
status: accepted
---

# Adopt the Commerce discovery, cart and order catalogues

**Accepted 17 October 2026.** The platform owner explicitly approved the platform-controlled namespace `urn:chat-marketplace:commerce` and exact identifiers `urn:chat-marketplace:commerce/discovery/v1`, `urn:chat-marketplace:commerce/cart/v1`, and `urn:chat-marketplace:commerce/order/v1` for slice 23.

## Decision

Commerce surfaces use these three versioned catalogue IDs, registered with Weaver using the Basic Catalog schema factory until commerce-specific typed components are separately reviewed. The catalogue ID and schema `$id`/`catalogId` must match. These identifiers grant no approval to other commerce catalogue names or versions. Commerce IDs are independent from the owner-approved shortlet namespace and IDs in ADR 0102.

Commerce presentations contain data only. They do not recalculate authoritative facts, execute model-produced UI or create contractual/financial state. Checkout proposals are persisted with their task, tenant, principal, exact quote snapshot and version. The explicit `commerce.checkout.confirm` action resolves through the platform `ActionSpec` gate to the typed `commerce.checkout.confirm` command; the conventional route uses the same command spec, schema, authorization and handler. The command enforces proposal/version/cart/quote freshness, an atomic one-shot dispatch claim, a stable idempotency key, and minimal transition audit evidence (ADR 0072/0075). When no checkout executor is configured, confirmation is accepted as an explicit command but returns `payment_unavailable`; it creates no Merchant Order and transfers no money. No commission or payment policy is inferred by this decision.

## Constraints

- ADR 0073: only the exact approved catalogues are registered; unknown IDs fail closed.
- ADR 0074: unsupported or stale surfaces cannot retain action authority.
- ADR 0075: product content and tool results are untrusted data and are minimized before interaction projection.
- ADR 0077/0080: projections preserve authoritative values and checkout has a deterministic conventional path.

The implementation validates all three registrations through the actual Weaver runtime factory and renders them with the matching catalogue IDs. Scripted assistant tests exercise proposal, explicit confirmation, conventional-command parity, stale/unauthorized rejection, idempotent retries and the safe unavailable executor result.
