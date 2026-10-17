---
status: accepted
---

# Adopt the Shortlet discovery and booking catalogues

**Accepted 17 October 2026.** The platform owner approved the platform-controlled namespace `urn:chat-marketplace:shortlet`, with the exact catalogue IDs `urn:chat-marketplace:shortlet/discovery/v1` and `urn:chat-marketplace:shortlet/booking/v1`, subject to runtime and schema validation. The URN uses the project name already present in ADR 0069 (`com.chat-marketplace.interaction/agui-v1`) and makes no claim to own a public domain. The repository's configured public origins (`staging.shortlet.ng` and `pilot.shortlet.example`) are deployment configuration, not evidence of domain ownership.

## Context and evidence

ADR 0081 deferred custom catalogues until the Basic Catalog proved insufficient. Four post-render organizers in `apps/local-guest/src/client.ts` demonstrate that insufficiency: `organizeUnitDetail`, `organizeBookingTicket`, `decorateDiscoveryCards` and `decorateComparison`. Three locate facts using label prefixes supplied through `GUEST_FACT_LABELS` and `guestFact`; the comparison organizer relies on rendered DOM position. These contracts make copy changes capable of silently breaking presentation.

## Decision

Approve two versioned catalogue IDs under one platform-controlled namespace:

| Catalogue | Approved identifier | Planned typed components |
| --- | --- | --- |
| Discovery | `urn:chat-marketplace:shortlet/discovery/v1` | `StayCard`, `StayComparison`, `UnitDetail` (issues 05–07) |
| Booking | `urn:chat-marketplace:shortlet/booking/v1` | `StayTicket`, `PriceBreakdown` (issue 04) |

The schemas are compile-time bundles embedding all Basic Catalog components. Weaver 0.2.1 uses plain `CatalogRegistration { catalogId, schema }`; no dynamic schemas are permitted. The catalogue schema and renderer registration are versioned together. Breaking changes require a new major version under ADR 0073's ownership, accessibility, security, fallback, fixture and replay review.

Every component accepts validated typed properties, rejects additional properties, and renders only through platform-owned guest-kit helpers. Text is escaped. No agent HTML, hidden controls, arbitrary code or automatic contractual/financial submission is permitted (ADR 0073 and ADR 0075).

An older client that does not recognize a catalogue must reject it and retain complete textual meaning with a conventional route; it must not silently omit content (ADR 0074). Prices, deadlines and eligibility are projections and are never recalculated by a channel renderer (ADR 0077). Rich UI is optional; reflow, keyboard use, assistive technology, and 44-by-44 CSS-pixel controls remain governed by ADR 0078.

This proposal amends ADR 0081's Basic-only deferral for these two catalogues only, based on the evidence above. `platform-common/v1`, `shortlet-incident/v1` and `shortlet-operator/v1` remain deferred. Replays, safe rejection and rollback remain required by ADRs 0079, 0080 and 0081.

## Approval

**Approval recorded:** the owner explicitly approved the namespace and both exact identifiers in the implementation conversation on 17 October 2026. Runtime registration and validation remain implementation gates. Weaver 0.2.1 validates `catalogId` as a string, requires it to equal the registration ID and schema `catalogId`, and successfully registers both approved IDs in the focused runtime tests.
