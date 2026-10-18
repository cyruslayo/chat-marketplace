# PRD: Weaver 0.2.1 and the `shortlet-*` catalogues

Status: ready-for-agent
Requested: 6 Oct 2026

## Problem

The web A2UI integration has two gaps.

1. **Historical migration context — completed in issue 01 (`6503849`).**
   - The app previously consumed `@weaver/core` and `@weaver/web` 0.1.2 as tarballs in `vendor/weaver/`, before the 0.2.1 packages were published to npm.
   - The published release is `@cylayo/weaver-core` and `@cylayo/weaver-web` **0.2.1**, from tag `v0.2.1` (`05cd279`) at <https://github.com/cyruslayo/weaver>.
   - 0.2.0 added the producer (`createA2UIV091Producer`), validated JSONL stream ingestion and runtime safety budgets. 0.2.1 only moved the packages to the `@cylayo` scope.
   - Renderer and registry APIs are unchanged.
   - The catalogue-definition helper (`defineCatalog`) landed on Weaver main after the tag (`cada149`) and is **not** in 0.2.1.
2. **The client patches Weaver's DOM after it renders.**
   - `apps/local-guest/src/client.ts` rearranges rendered surfaces into guest-kit markup: `organizeUnitDetail`, `organizeBookingTicket` and `decorateDiscoveryCards`.
   - It finds facts by their label text: `findFact` matches `"Check-in: "`, `"Bedrooms: "`, `"Where: "`, `"All-In Stay Total: "` and so on.
   - `decorateComparison` does the same by DOM position.
   - This is the evidence ADR 0081 asked for before custom catalogues: the Basic Catalog is not enough to express these screens. The label matching is fragile, because any copy change silently breaks the layout.

## Goal

- The app depends on `@cylayo/weaver-*` 0.2.1 from npm.
- Every A2UI builder emits its envelopes through `createA2UIV091Producer`.
- The unit detail, booking ticket and price breakdown, discovery cards and comparison render through typed components in two custom catalogues, `shortlet-discovery/v1` and `shortlet-booking/v1`.
- Their renderers reuse the guest-kit helpers, so the chat still produces the same markup as the standalone pages, and the post-render organizers and label matching are deleted.

## Decisions (taken with the user, 6 Oct 2026)

| Topic | Decision |
| --- | --- |
| Dependency source (implemented in issue 01, `6503849`) | npm, exact pins `"@cylayo/weaver-core": "0.2.1"` and `"@cylayo/weaver-web": "0.2.1"`; the vendored tarballs and verifier were removed and the retired package script was deleted. No ADR requires vendoring, and the lockfile's sha512 integrity is as tamper-evident as the previous vendored hashes. |
| Catalogue helper | Stay on 0.2.1. Use plain `CatalogRegistration { catalogId, schema }` with a small local typed `defineShortletCatalog` that mirrors upstream `defineCatalog`, and swap it out when Weaver releases it. |
| Scope | The three named organizers plus `decorateComparison`. The downstream `organizeRequestScreen`, `organizeOfferScreen`, `organizePaymentScreen` and `organizeConfirmation` stay; they keep reading the `.ui-ticket` and `.ui-price-breakdown` the new renderers produce. |
| Renderer markup | Renderers call the existing `guest-kit.ts` helpers (`ticketHtml`, `breakdownHtml`, `unitTilesHtml`, `unitAboutHtml`, `stayCardInnerHtml`, `resultRowPartsHtml`) with typed props and parse the result through a `<template>`, as `replaceWithKitMarkup` does today. One markup source serves the page and the chat. |

## Out of scope

- **Stream ingestion** (`createA2UIV091StreamIngestion`). Surfaces arrive as complete message arrays in the JSON payload; there is no streaming path to adopt it on.
- **Other surfaces.** Request, offer, payment and confirmation screen organizers, and every other Basic-Catalog surface (cancellation, relocation, check-in support and the rest).
- **Raising Weaver's default safety budgets** (resolution depth 32, 1,000 instances) unless a fixture proves it is needed.
- **The other three ADR 0073 catalogues:** `platform-common/v1`, `shortlet-incident/v1` and `shortlet-operator/v1`.

## ADR compliance

| ADR | Constraint | Applies to |
| --- | --- | --- |
| 0081 | Weaver is the A2UI v0.9.1 runtime. No Weaver types in domains, platform-core or authoritative models. Custom catalogues are deferred until the Basic Catalog is shown to be insufficient. Upgrades need replay, parity and verified rollback. | All issues. 03 writes ADR 0102 recording the evidence. `test/weaver-dependency-boundary.test.ts` stays green. |
| 0073 | Catalogues are named `shortlet-discovery/v1` and `shortlet-booking/v1` under a platform-controlled namespace. Schemas are compile-time bundles. No dynamic schema, raw HTML from the agent, hidden controls or automatic contractual or financial submission. Every outbound message passes A2UI, catalogue and semantic validation. | 03–07 |
| 0074 / 0068 | An unsupported catalogue or a render failure fails closed to complete text plus a conventional route, and never silently omits meaning. State is restored from server projections. | 03 (stale-client test), 04–07 |
| 0075 | Renderers accept validated typed properties only and never execute agent content. | 03–07. Props are schema-checked with `additionalProperties: false`, and every value is escaped by the kit's `escapeHtml`. |
| 0077 | Channel adapters never recalculate prices, deadlines or eligibility. | 04–07. Props carry display strings formatted on the server, such as `formatNgnKobo`. |
| 0078 | WCAG 2.2 AA, 44 by 44px targets, 320px reflow. Rich UI is optional; comprehension is not. | 04–08 captures and checks |
| 0079 / 0069 | Runtime and renderer upgrades need replay, semantic-command parity, safe rejection, accessibility and security checks, and rollback. | 01, 03 |
| 0080 / 0093 | Conventional no-JS routes keep command parity. | Conventional pages are unchanged. The existing no-JS tests stay green. |

## Issues and order

See `map.md`.
