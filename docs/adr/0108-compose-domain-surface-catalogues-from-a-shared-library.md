---
status: accepted
---

# Compose domain Surface Catalogues from one shared component library

**Accepted 18 Nov 2026.** The owner accepted this decision and all eleven recommendations in `.scratch/surface-catalogue-library/analysis.md` §11 ("Accept all"). It creates no new catalogue ID: `platform-common/v1` and any future catalogue ID still need the owner's explicit approval (ADR 0073). Analysis: `.scratch/surface-catalogue-library/analysis.md`. Plan: `.scratch/surface-catalogue-library/map.md`.

## Context

- ADR 0073 requires closed, versioned, domain-specific catalogues.
- ADR 0102 and ADR 0103 approved the shortlet and commerce IDs. All five catalogues are still clones of the Weaver Basic Catalog, with no typed components (`SHORTLET_RENDERERS` is empty).
- Typed components are planned (weaver-catalogues 04–07). Future domains (events, services, communities) will need many of the same shapes: result cards, detail views, money breakdowns, status tracking and places.
- A2UI v0.9.1 and Weaver 0.2.1 bind one catalogue to each surface and resolve `$ref` only inside the registered document. A catalogue therefore cannot reference shared components at runtime.
- The model does not compose surfaces. Pack code builds them from authoritative artifacts.

## Decision

1. **Surface Component.** A reusable UI component is defined once, as:
   - a strict props schema,
   - a props type,
   - one kit HTML helper (shared by the chat and the no-JS page),
   - a complete text fallback,
   - fixtures,
   - an accessibility contract,
   - a semver version.

   Channel renderers, Weaver first, are thin adapters over the HTML helper.
2. **Tiers.**
   - Tier 0: the Weaver Basic Catalog (vendor).
   - Tier 1: platform components, owned by the platform.
   - Tier 2: archetypes shared by two or more real domains, varied only by named optional slots and shape-named enums, never by domain-named enums.
   - Tier 3: domain-only components, owned by the pack.

   Tiers 1 and 2 hold no domain vocabulary and no copy. A component moves from Tier 3 to Tier 2 only when a second real domain needs it, and is then designed against both. A built but parked pack counts as a real domain; a test-only fixture pack does not.
3. **Catalogue Manifest.** A pack declares each catalogue as a static manifest: an owner-approved ID, the base catalogue, the components it uses under domain alias names with their pinned major and slot choice, and the allow-listed action event names. Each allow-listed name is either one of the pack's `ActionSpec` names (consequential, ADR 0072) or one of the pack's declared presentation events, such as viewing or comparing a unit, which change no domain state. At build time the platform composes each manifest into one self-contained A2UI v0.9.1 schema, narrowed to each alias's slot choice, plus one renderer registration per alias.
4. **One source of registration.** The platform `CatalogueRegistry` and the Weaver runtime are both fed from the manifests of registered packs only. An unregistered or parked pack has no catalogues (ADR 0104, ADR 0107 decision 10).
5. **Boundaries.** The library is a Weaver-free package. It imports no domain or app code. Only one adapter module pairs it with Weaver. No pack's presentation code imports another pack's.
6. **Versioning.**
   - Adding an optional prop, an optional slot or a layout enum value is a minor version of the component. Anything else is a major version.
   - A catalogue takes a component's new major only under a new catalogue major, after ADR 0073 review.
   - Composed catalogues are snapshotted. A non-additive diff without a catalogue major bump fails the build.
7. **Surfaces stay pack-built.** This decision does not let the model compose or choose components. Any such change needs its own ADR.

## Consequences

- A new domain declares manifests, aliases, slot choices, copy and a mode token block, plus any Tier 3 components it needs. Platform and shell code stay unchanged.
- weaver-catalogues 04–07 are built in this format, after a refactor-only skeleton phase that keeps the shortlet catalogue schemas byte-identical.
- A test-only fixture pack proves the second-domain path without starting commerce work.
- The platform `CONTEXT.md` gains **Surface Component** and **Catalogue Manifest**. "Surface Catalogue" is used where "catalogue" could be confused with the commerce product catalogue.
- Costs:
  - one generated renderer registration per alias;
  - snapshot maintenance;
  - strict props mean an additive change falls back to text in tabs that predate the deploy (covered by the stale-client test).

## Related

ADR 0069, 0072, 0073, 0074, 0075, 0077, 0078, 0079, 0080, 0081, 0099, 0102, 0103, 0104, 0106, 0107.
