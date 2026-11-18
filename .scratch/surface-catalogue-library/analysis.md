# Surface Catalogue Library: analysis and recommendation

Status: **accepted 18 Nov 2026.** The owner accepted every recommendation in §11 ("Accept all"), recorded as ADR 0108 (`docs/adr/0108-compose-domain-surface-catalogues-from-a-shared-library.md`).
Research and sources: `reports/Surface catalogue library prior art.md`.
Phase 1 plan: `PRD.md` and `map.md` in this folder.

## 1. The question

Each domain (stays now; commerce parked; later events, services/reservations, communities) needs its own UI components that the agent shows through the Weaver A2UI runtime. Building a separate component set per domain will not stay manageable. The owner wants a catalogue library that:

- can be extended when a domain is activated,
- reuses components across domains where the domains really share a shape,
- is designed now, so a new domain is cheap to switch on later.

## 2. Short answer

1. **Define each component once, in a domain-neutral library. Build each domain catalogue from it at compile time.** A2UI v0.9.1 and Weaver 0.2.1 require every catalogue to be one self-contained document, with one catalogue per surface (verified in Weaver's `referencesResolve`, §4.1). Reuse therefore has to happen in the source, not on the wire. Weaver already works this way for its Basic Catalog: `createBasicCatalogRendererRegistrations({ catalogId })` stamps the same renderers onto any catalogue ID.
2. **The unit of reuse is not a Weaver renderer.** It is a *Surface Component*: a typed props schema, one guest-kit markup helper, a plain-text fallback, fixtures, and thin channel adapters, of which Weaver is only one. The no-JS pages (ADR 0080), the text fallback (ADR 0074), the future WhatsApp and MCP channels (ADR 0077) and the Weaver chat all need the same contract.
3. **Use four tiers and promote components upward only on evidence.** The tiers are vendor primitives, platform components, cross-domain archetypes and domain-only components. A component starts in its domain and moves into the shared tier only when a second real domain needs it (rule of three; ADR 0099 decision 7). Commerce counts as that second domain: it is built and only parked. A shared component is designed against commerce's existing presentation code on paper, with no commerce code changed.
4. **On the wire, keep each domain's own words.** `shortlet-discovery/v1` keeps the `StayCard` name that ADR 0102 approved, but `StayCard` is an alias of the shared `ResultCard@1`. The manifest chooses which of `ResultCard`'s optional slots `StayCard` uses. Commerce would expose `ProductCard` as another alias of the same component, with its own slot choice. Each catalogue pins its own component majors, so one domain can move to a new version without breaking another. I checked this against Weaver 0.2.1 with a scratch script (§4.1).
5. **"Ready for new domains" should mean ready on paper, not built.** For events, services and communities, the library gets a checked component inventory, a commonality and variability matrix (§7) and reserved archetype names. It does not get components nobody uses yet. Building them early would break ADR 0099 decision 7 and the agent-modes sequencing, and the literature calls it the classic wrong-abstraction trap (§5).
6. **The agent does not compose components today, and that should stay.** Pack code builds every surface from authoritative artifacts. The model picks tools; it never writes A2UI. That is why a growing catalogue stays manageable: it is a code library, not a prompt. Letting the model compose surfaces would be a separate owner decision against ADR 0073, 0077, 0106 and 0107 (decision 7 in §11).

## 3. What exists today (measured on `docs/ux-guidelines` at 78135f7)

| Fact | Evidence |
| --- | --- |
| Surfaces are built by pack code from artifacts. The model never emits A2UI. | `AssistantDomainPack.discoverySurface`, `bookingRequestSurface`, … (`apps/local-guest/src/assistant/assistant-platform.ts:171-176`); the `*ArtifactToA2UI` builders in `apps/web-agent/src/`. The pack interface has no "compose UI" tool. |
| Nearly every builder still emits the Weaver Basic Catalog. | 21 builder files in `apps/web-agent/src/` use `A2UI_V091_BASIC_CATALOG_ID`, and so does `pending-action-a2ui.ts`. |
| The approved custom catalogues are clones of the Basic Catalog. | `shortlet-catalogs.ts` and `commerce-catalogs.ts` copy the Basic schema and change only its ID. `SHORTLET_RENDERERS` is `[]` (`apps/local-guest/src/shortlet-renderers.ts`). |
| The client rewrites Weaver's DOM after it renders. | 9 `organize*`/`decorate*` functions in `apps/local-guest/src/client.ts` (3,003 lines). Some find facts by their label text. ADR 0102 cites this as the evidence for custom catalogues. |
| The typed components are planned but not built. | weaver-catalogues issues 02 and 04–08 are `ready-for-agent`: StayTicket, PriceBreakdown, UnitDetail, StayCard, StayComparison. |
| The markup helpers already exist and are mostly domain-neutral. | `apps/local-guest/src/guest-kit.ts` (816 lines): `priceBreakdownHtml`, `stayTicketHtml`, `stayCardInnerHtml`, tiles, facts. The design system's "Guest UI kit" list is the component inventory (`docs/design/shortlet-design-system-direction.md`). |
| The two catalogue registries use different ID schemes. | `packages/platform-core/src/surface.ts` registers short IDs (`"discovery/v1"`, …) in `CatalogueRegistry` through its default only. Weaver registers URNs (`urn:chat-marketplace:shortlet/discovery/v1`). Nothing derives one from the other. Multi-domain issue 11 noted on 14 Oct that "the shortlet pack registers the same ids here" once weaver-catalogues 03 landed. 03 has landed, but no pack calls `CatalogueRegistry.register`, and the PRD's `catalogues: CatalogueDefinition[]` exists in no code. |
| Enabling a pack's catalogues is hard-coded. | `createShortletWebRuntime({ commerce })` switches commerce catalogues on with a boolean, instead of building the set from the registered packs (ADR 0107 decision 10). |
| The name "Catalogue" already means something in commerce. | `domains/commerce/CONTEXT.md` uses "Catalogue" for products and Merchant Offers. |

Conclusion: no typed component has been written yet. That makes now the cheapest time to settle the library shape. The five components in weaver-catalogues 04–07 can be the first ones built in it, rather than being written one way and moved later.

## 4. Hard constraints

### 4.1 The wire format

- **One catalogue per surface.** In A2UI v0.9.1, `createSurface.catalogId` is fixed for the surface's lifetime. Mixing catalogues inside one surface (a per-component `@catalogId`) only arrives in v1.0, which ADR 0069 keeps as candidate-only.
- **Catalogues are self-contained.** Weaver's `referencesResolve` (`node_modules/@cylayo/weaver-core/dist/catalog/schema-validator.js:105`) resolves a `$ref` only against the registered document and the resources embedded in it by `$id`. A reference to another registered catalogue fails registration. Shared component schemas can therefore be *embedded* in each catalogue at build time, but not *referenced* across catalogues.
- **Renderers are keyed by catalogue and component.** `RendererRegistry.get(catalogId, component)`. One shared renderer must be registered once per catalogue that contains it. Weaver's own Basic helper does exactly that.
- **Strict props.** ADR 0102 requires `additionalProperties: false`. A client that has not been redeployed rejects a message that uses a new property, so even an "additive" change is visible on the wire (see §8).
- **Aliasing works.** A scratch script against Weaver 0.2.1 did the following:
  1. Cloned the Basic Catalog (18 components and 14 functions, counted locally).
  2. Added a shared, domain-neutral card schema under the alias `StayCard`, using the existing `common_types.json#/$defs/Action` slot.
  3. Registered the catalogue with `CatalogRegistry` and created a runtime with `createWeaverRuntime`.

  Results:
  - Valid props validated.
  - An extra `nightlyKobo` prop was rejected.
  - The un-aliased name `ResultCard` was rejected.
  - `getActionProperties` found the action slot.

  A custom *renderer* registration has not been exercised yet; it is phase 1's first acceptance criterion.

### 4.2 ADR constraints

| ADR | Constraint | Where it lands in the design |
| --- | --- | --- |
| 0073 | Closed, versioned catalogues under a platform namespace. No dynamic schema, agent HTML, CSS injection, hidden controls or automatic contractual or financial submission. Breaking changes get a new major after review. | Manifests are static and compile-time (§6.3). Versioning rules (§8). New catalogue IDs need owner approval (decisions 4 and 5). |
| 0074 | A failed, unknown or stale surface falls back to complete text plus a conventional route, and never silently drops meaning. | Every Surface Component must have a text fallback (§6.1), checked by test. |
| 0075 | Data minimization. Content is untrusted and escaped. | Props are validated and escaped by the kit helper. Communities raise user-generated content (§7.3). |
| 0077 | One copy source. Channels never recalculate prices, deadlines or eligibility. | Shared components hold no copy; labels and formatted amounts arrive as props from `guest-content.ts` and server formatters (§6.4). |
| 0078 | WCAG 2.2 AA, 44px targets, 320px reflow. | A per-component accessibility contract plus the capture sweep, run once per component in a gallery (§9). |
| 0079 | Replay and rollback on runtime or renderer change. | Composed-catalogue snapshots and fixture replay (§8). |
| 0080 | Deterministic no-JS parity. | The kit markup helper serves both the no-JS page and the Weaver renderer (§6.1). |
| 0081 | Weaver types never enter domains, platform-core or authoritative models. | The library core is Weaver-free; the Weaver adapter is a separate module (§6.2). |
| 0099 | Packs declare and never reach in. No pack imports another. Platform owns Payments, Handoff and Surfaces. Shape the interface against two real packs. | Packs declare manifests; the platform composes them. Tier 1 is platform-owned. Promotion needs two real consumers (§5). |
| 0102 / 0103 | The approved IDs and planned component names (`StayCard`, `StayTicket`, …). Commerce catalogues use Basic until typed components are reviewed. | Aliases keep the approved names (§6.3). Commerce is unchanged. |
| 0104 | Commerce stays off. | Commerce is not touched. The second-domain proof uses a test-only fixture pack (decision 6). |
| 0106 | No model-generated UI shortcuts. Ids stay fail-closed across cold restores. | Surfaces stay pack-built (§2.6). The library adds no ids and no state. |
| 0107 | A mode changes accents through `--mode-*` tokens only. Registering a pack creates its mode. | Shared components read `--mode-*` tokens, so one component takes each domain's accent with no per-domain CSS. Catalogue registration follows pack registration (§6.5). |

## 5. What the literature says (summary; full notes and sources in the report)

| Source | Lesson for us |
| --- | --- |
| **DDD context mapping** (Evans 2003; DDD Reference 2015; Vernon 2013) | Each domain is a bounded context with its own language. Share a *small* shared kernel and change it only by agreement. Translate at the edge with an anticorruption layer. A design system is a *generic subdomain*: keep it boring and do not let it pull in domain concepts. → The pack's projection is the anticorruption layer from domain model to component props; the library is the shared kernel; domain words appear only in aliases and copy. |
| **Software product lines** (Parnas 1972; Coplien, Hoffman and Weiss 1998, commonality and variability; Clements and Northrop 2001; Pohl et al. 2005) | Identify what all members share and name each variation point. Commonality becomes the interface and variability becomes the hidden secret. → Archetypes have named, closed variation points (§7), not open "config" bags. |
| **Design system tiers** (Curtis, "Design System Tiers", 2019; "Team Models", 2015) | A small, high-quality core used by everyone, with lower tiers for shared features and experiments, and clear criteria for promotion. → The four tiers and the promotion rule (§6.2, §10). |
| **Atomic design** (Frost 2016) | Atoms, molecules, organisms, templates. → Tier 0 is atoms (Basic Catalog); Tier 1 and 2 are molecules and organisms. We do not need templates, because the pack chooses the layout. |
| **Wrong abstraction / rule of three** (Metz 2016; Roberts, in Fowler's *Refactoring*; Ousterhout "design it twice") | Duplication is cheaper than the wrong abstraction. Abstract on the third use, or at least after designing against two. → Do not build event or community components now. |
| **Micro frontends** (Jackson, martinfowler.com 2019; Geers 2020) | Shared component libraries should hold UI logic only. Shared domain logic couples teams. → No domain enums or rules in shared components. |
| **UI and ViewModel composition** (Dahan 2012; Servienti) | Each service owns its slice of data, and a composition layer assembles the view. → Each pack owns its projection; the platform composes surfaces. |
| **Server-driven UI in production** (Yelp 2026, read in full; Airbnb Ghost Platform, from summaries only because the article returned 403) | Yelp generates four platform libraries from one JSON definition per component, versions each component, has each client declare the versions it supports, and backports newer models for older clients. Airbnb reuses typed sections across screens. → One definition per component that generates the schema, the types and the registrations. Versioned components. |
| **Microsoft Adaptive Cards** (schema `version`, `fallback`, `requires`, host config) | A card carries a fallback text and requires features at minimum versions; the host config controls presentation. → The text fallback is required. Mode tokens play the role of host config. |
| **A2UI catalogue guidance** (a2ui.org, read in full) | Catalogues are self-contained, the version goes in the URI path, domain catalogues add components to the Basic set, and the agent "sends no UI if none match". → Embed at build time; `/v1` in the URN; fail closed. |
| **Vercel json-render; MCP Apps (SEP-1865); Google "Generative UI" (2025)** | These are about the *model* composing UI from a catalogue (json-render, Google) or about servers shipping sandboxed HTML (MCP Apps). They are useful only as later options: the model does not compose surfaces here, and Google reports generation taking a minute or more, with occasional errors. MCP Apps matters later as one more channel adapter. |

Is DDD relevant? Yes, but at the strategic level (context maps), not the tactical one (aggregates). It tells us **what may be shared** (presentation shapes, not domain concepts), **who owns the shared part** (the platform, as a small shared kernel), and **where translation happens** (in each pack's projection).

## 6. Proposed architecture

```
 domains/<d>                 apps/web-agent/src/<d>/ (pack presentation)          packages/surface-kit (new, Weaver-free)
 ┌──────────────┐  artifact  ┌──────────────────────────────┐ props  ┌─────────────────────────────────────────┐
 │ domain model │ ─────────▶ │ projection = anticorruption  │ ─────▶ │ Tier 1 platform components              │
 │ (authority)  │            │ layer: artifact → typed props│        │ Tier 2 archetypes (ResultCard, …)        │
 └──────────────┘            │ + Tier 3 domain components   │        │ each: schema · props type · html · text  │
                             │ + catalogue manifests        │        │ fallback · fixtures · a11y contract      │
                             └──────────────┬───────────────┘        └───────────────────┬─────────────────────┘
                                            │ manifest                                    │
                                            ▼                                             ▼
                   composeCatalogue(manifest) → self-contained A2UI v0.9.1 schema   adapters (one per channel)
                   rendererRegistrations(manifest) → one per (catalogId, component)   ├─ Weaver renderer (chat)
                                            │                                         ├─ no-JS page (same html)
           host composition root registers only enabled packs' manifests              ├─ text fallback / WhatsApp
           (platform CatalogueRegistry and Weaver runtime fed from the same list)     └─ MCP App resource (later)
```

### 6.1 The Surface Component (unit of reuse)

Each component is one folder with one owner:

| Part | Purpose | Rule |
| --- | --- | --- |
| `schema` | A2UI component JSON Schema (draft 2020-12) | `additionalProperties: false`; bounded strings and arrays; closed enums; actions only as A2UI `Action` slots |
| `props` type | TypeScript type of the validated props | Kept equal to the schema by a type test (or derived from one source; decision 1) |
| `html(props)` | Server markup, the existing guest-kit helper | The only markup source; escapes every value; semantic tokens only |
| `text(props)` | Complete plain-text rendering | Carries all the meaning (ADR 0074); used for the fallback and text channels |
| `fixtures/` | Valid and invalid examples, including the longest strings and 320px cases | Drive schema, replay, capture and gallery tests |
| a11y contract | Roles, the name of every control, target sizes, reduced motion | Checked once in the gallery capture, not per screen |
| version | Semver for the component | Rules in §8 |

The Weaver renderer is a thin adapter: hydrated props → `html(props)` → `<template>` → wire the `Action` slots to `interactions.dispatchAction`. This is exactly what `replaceWithKitMarkup` does today. Because chat and page share the same `html`, ADR 0080 parity holds by construction rather than by matching labels.

### 6.2 Tiers and where the code lives

| Tier | Contents | Owner and location | Examples |
| --- | --- | --- | --- |
| 0 Primitives | Weaver Basic Catalog (18 components, 14 functions) | Vendor (`@cylayo/weaver-*`) | Text, Row, Column, Button, Image, TextField |
| 1 Platform components | Shapes the platform itself owns (ADR 0099 decision 2: Payments, Handoff, Surfaces) | Platform: `packages/surface-kit/src/platform/` | MoneyBreakdown, FactTiles, StatusBanner, Steps, Deadline, PaymentHandoff, HandoffNotice, Receipt, Empty/Stale, QuickReplies |
| 2 Archetypes | Shapes found in two or more real domains (stays and commerce today; commerce is built but parked), with named optional slots | Platform (shared kernel): `packages/surface-kit/src/archetypes/` | ResultCard, DetailView, Comparison, CommitmentSummary, LineItems, StatusTracker, Place. AvailabilityPicker is a reserved name only (§7.3). |
| 3 Domain components | Shapes only one domain has | The pack: `apps/web-agent/src/<domain>/components/`, built with the library's `defineSurfaceComponent` | Stays: InspectionSummary. Commerce: VariantPicker. Events (future): SeatMap |

Boundary tests (extending `test/weaver-dependency-boundary.test.ts` and the ADR 0099 boundary test):

1. `packages/surface-kit` imports nothing from `domains/*`, `apps/*` or `@cylayo/weaver-*`.
2. The Weaver adapter (`apps/web-agent/src/catalogues/weaver-adapter.ts` or similar) is the only module that pairs surface-kit with Weaver.
3. A domain's presentation folder never imports another domain's folder (ADR 0099 decision 4).
4. Tier 1 and Tier 2 schemas contain no word from a domain glossary as an enum value or a property name. A lint test reads the `CONTEXT.md` glossaries, so `nightlyKobo` or `merchantOfferId` cannot leak into a shared component.

### 6.3 Catalogue manifests (what a pack declares)

A pack declares one manifest per catalogue. Platform code compiles it.

```ts
// apps/web-agent/src/shortlet/catalogues.ts (sketch only; the shape is decided in phase 1)
export const SHORTLET_DISCOVERY = defineCatalogueManifest({
  id: "urn:chat-marketplace:shortlet/discovery/v1",   // ADR 0102, unchanged
  owner: "shortlet",
  base: "basic/v0.9.1",                                // Tier 0 embedded
  components: {
    // The manifest narrows the shared schema: it chooses which optional slots the alias allows or requires.
    StayCard:       use(ResultCard, { major: 1, slots: { media: "required", price: "required", badges: "optional", schedule: "absent" } }),
    UnitDetail:     use(DetailView, { major: 1, slots: { gallery: "required", place: "required" } }),
    StayComparison: use(Comparison, { major: 1 }),
  },
  actions: ["<view-unit ActionSpec name>", "<review-request ActionSpec name>"], // placeholders: the pack's real ActionSpec names
});
// The booking manifest does the same, e.g. PriceBreakdown: use(MoneyBreakdown, { major: 1 }) and StayTicket: use(CommitmentSummary, …),
// keeping the names ADR 0102 approved.
```

- `composeCatalogue(manifest)` embeds the Basic schema plus each used component's schema under its alias. It narrows the schema to the slot choice: absent slots are removed, so `additionalProperties: false` rejects them, and required slots are added to `required`. It emits one self-contained document whose `$id` and `catalogId` equal `id`. A new domain therefore changes only its own manifest, never the shared component.
- `rendererRegistrations(manifest)` emits one `RendererRegistration` per alias.
- A semantic validator checks every emitted `Action` name against `manifest.actions`. Each listed name is either a pack `ActionSpec` name (consequential, ADR 0072, 0099 decision 3) or a pack-declared presentation event that changes no domain state, such as `VIEW_UNIT_EVENT` or `COMPARE_UNIT_EVENT` in `discovery-a2ui.ts`.
- The same manifests feed `platform-core`'s `CatalogueRegistry`. This removes the short-ID versus URN drift and the `{ commerce: boolean }` flag: the host registers the manifests of the packs it registers (ADR 0104, 0107 decision 10).

**Why aliases?** The model never reads component names, but the wire contract is still read by replay fixtures, by future channels and by the people maintaining it.

- Aliases keep each bounded context's language (DDD).
- They keep the names ADR 0102 already approved.
- They let one catalogue pin `ResultCard@1` while another moves to `@2`.
- If a domain later needs something different, it can replace the alias with its own Tier 3 component without changing the wire name ("separate ways").

The cost is one generated registration per alias. The alternative is to put `ResultCard` directly on the wire. It is simpler, but it couples every domain's wire contract to the shared one (decision 2).

### 6.4 Variation without domain leakage

- **Copy:** shared components hold no strings. Every label arrives as a prop from the pack's entries in `guest-content.ts` (ADR 0077). This removes the root cause ADR 0102 found: layout that depends on label text.
- **Money and dates:** props carry display strings already formatted on the server (`formatNgnKobo`, WAT dates). Components never compute (ADR 0077). Where sorting or comparison needs a number, the number travels beside its display string and is never re-formatted.
- **Trust and status:** a shared `badges` prop is `{ label, tone: "positive"|"neutral"|"caution", icon: <kit icon name> }`. The pack maps "Inspected" or "Verified merchant" onto that shape. No domain trust enum enters the library.
- **Variation by shape, not by domain:** an archetype exposes named optional slots (for example ResultCard: `media`, `facts`, `price`, `badges`, `schedule`, `place`) and, where needed, a shape-named layout enum (`media-first | text-first`). It never has a domain-named enum such as `stay | product`, which would break boundary test 4 and force every new domain to edit shared code. Each alias's slot choice lives in its domain's manifest (§6.3). A new slot is a minor version of the archetype and needs a reviewed fixture.
- **Accent:** components read `--mode-*` tokens only (ADR 0107 decision 4). A domain gets its look from its mode token block, not from component CSS.

### 6.5 Channels

The text fallback and the HTML helper make every component channel-ready:

- no-JS page: `html`
- chat: Weaver adapter over `html`
- WhatsApp: `text`, plus structured content where the ADR 0077 capability matrix allows it
- MCP Apps / ChatGPT widgets (multi-domain issue 29, later): `html` plus the kit CSS, served as a `ui://` resource

This is why the reusable unit must not be the Weaver renderer.

## 7. Commonality and variability across domains (paper walkthrough)

### 7.1 Matrix

`✓` = the domain needs it; text = its domain alias or slot choice; `—` = not needed. Stays is built (weaver-catalogues 04–07); commerce exists and is parked; the other three are hypothetical and need an owner decision first.

| Archetype (Tier 2) | Stays | Commerce | Events | Services / reservations | Communities |
| --- | --- | --- | --- | --- | --- |
| ResultCard | StayCard | ProductCard | EventCard | ServiceCard / VenueCard | GroupCard |
| DetailView | UnitDetail | ProductDetail | EventDetail | ServiceDetail | GroupDetail |
| Comparison | StayComparison | ProductComparison | — | ✓ | — |
| AvailabilityPicker (date range · time slot · session) | date range | — | session | time slot | — (event RSVP reuses Events) |
| PartyOrQuantity | guests | quantity | tickets per tier | party size | — |
| LineItems | fees, extras | cart lines | ticket tiers | deposit, add-ons | — |
| CommitmentSummary (the thing being committed to) | StayTicket | Order summary | Ticket | Reservation | Membership |
| StatusTracker | booking stages | order tracking | ticket status | reservation status | join request |
| Place (address + static map + safe "open in maps" link) | neighbourhood | store / delivery zone | venue | venue | meeting point |
| **Tier 1, all domains:** MoneyBreakdown, PaymentHandoff, Receipt, Deadline, StatusBanner, Steps, HandoffNotice, QuickReplies, Empty/Stale | ✓ | ✓ | ✓ | ✓ | most (often no payment) |

| Tier 3 (domain only; promote on a second real use) | Domain |
| --- | --- |
| InspectionSummary, ExtendedStay monthly breakdown | Stays |
| VariantPicker, DeliveryZoneNotice | Commerce |
| SeatMap, Lineup / Agenda | Events |
| InquiryForm (may become Tier 2 if services and stays both need it) | Services |
| Post, Thread, Poll, MemberList | Communities |

### 7.2 What the matrix shows

- About 9 archetypes and 9 platform components cover most of the five domains. Most of each new domain is configuration (aliases, slot choices, copy, mode tokens), plus a few Tier 3 components.
- The **map** the owner mentioned is the `Place` archetype: text address, an optional static map image and an allow-listed "open in maps" link. An interactive JavaScript map breaks the performance acceptance in the design system ("Avoid heavy maps … until value and network budget are validated") on the reference low-end Android phone. It would be a Tier 3, feature-detected enhancement inside the domain that proves it needs one.
- **Communities is the outlier.** Its content is user-generated (ADR 0075: untrusted, needs moderation), it is feed-shaped rather than transaction-shaped, and it often has no payment. Its ADR should decide whether chat surfaces are the right home for it before any component is designed.

### 7.3 Risks the walkthrough exposes

- **AvailabilityPicker is the most likely wrong abstraction.** Date ranges, time slots and sessions differ in validation, timezone and capacity rules. Keep it as a reserved name. Build the stays version as Tier 3 (`StayDatesPicker`) and extract it only when a second domain ships.
- **LineItems versus MoneyBreakdown.** Keep these separate: one lists what you get, the other adds up what you pay. Merging them would mix two jobs.

## 8. Versioning (the hard part)

Every composed catalogue embeds its components, so a change to a shared component changes the schema of every catalogue that pins it. The rules:

1. **Component semver.**
   - A new optional prop, a new optional slot or a new value in a shape-named layout enum is a **minor** version.
   - These are **major**: a new required prop, a removed or renamed prop, a narrowed enum, a changed meaning, or a rendering change that affects accessibility or reflow.
2. **Catalogues pin component majors.** A component's new major reaches a catalogue only when that catalogue's ID gets a new major (`…/discovery/v2`), after ADR 0073 review. The old major stays in the library until every manifest pinning it is retired.
3. **Minor changes reach clients that have not reloaded.** With `additionalProperties: false`, an open tab from before the deploy rejects a new prop and falls back to text. That is fail-closed and acceptable, because the client ships with the Worker. Two conditions apply:
   - The existing stale-client test must cover a new-prop fixture.
   - The server must not *depend* on the new prop for meaning until the deploy has settled.
   - Anything that cannot meet those conditions is a major version.
4. **Snapshot gate.** Each composed catalogue is snapshotted in `test/fixtures/catalogues/<id>.json`. A diff classifier:
   - lets additive diffs through with an updated snapshot,
   - fails any other diff unless the catalogue ID's major changed,
   - replays every fixture against every catalogue that uses the component (ADR 0079).
5. **Dual emit during a major change.** Only if a client ever advertises `supportedCatalogIds` (A2UI negotiation) does the server emit v1 to v1-only clients, for ADR 0069's 90-day window. Today the server and client deploy together, so this is a contingency, not a phase.
6. **Stored surfaces.** Built A2UI is not persisted today. A shell restore starts with `lastSurfaces: []` (`apps/local-guest/src/shortlet-app.ts:2707`) and rebuilds surfaces from the stored artifact and surface ids (ADR 0074, 0106). Only an open tab holds an old contract. If the ADR 0107 lane storage ever stores surface messages, two more rules apply:
   - a catalogue major cannot be retired while stored surfaces name it;
   - a revert after an additive change degrades the surfaces stored in between, which must re-project rather than re-validate.
7. **Do not use the "tolerant reader" pattern.** Ignoring unknown props would be the usual answer, but ADR 0073 and 0075 make strict rejection a security property. We keep strictness and pay for it with major versions.

## 9. Developer experience: what adding something costs

| Task | Steps | Tests that come for free |
| --- | --- | --- |
| New domain, all archetypes fit | manifest(s) + aliases + slot choices + copy in `guest-content.ts` + mode token block | composition, registration, renderer coverage, snapshot, fixtures, contrast (ADR 0107), boundary |
| New Tier 3 component | one folder (§6.1) in the pack | the above, plus its own schema, escape, text-completeness and gallery capture |
| Promote Tier 3 to Tier 2 | move the folder, generalize the domain props into slots, alias it back in the old manifest under the same wire name | the snapshot proves the old catalogue is byte-identical |

A **catalogue gallery** page renders every component's fixtures under every alias. It is served by the existing walkthrough and captured by the sweep at 320, 390, 768 and 1280, light and dark. Accessibility and reflow are then checked once per component, not per screen. This replaces the long tail of per-screen capture scripts for shared parts.

**Bundle budget.** Every registered pack's renderers ship in one `client.js`. Renderers are thin over shared HTML helpers, so growth is small. Add a size budget test now and lazy-load renderers per pack when a third pack is registered.

## 10. Phased plan

Each phase is a separate issue set under this folder, following the AGENTS implementation protocol and test scope.

| Phase | Delivers | Visible change | Depends on |
| --- | --- | --- | --- |
| **0 Decide (done 18 Nov 2026)** | Owner decisions in §11; ADR 0108 accepted; **Surface Component** and **Catalogue Manifest** added to the platform `CONTEXT.md` | none | owner |
| **1 Skeleton (pure refactor)** | `packages/surface-kit` with `defineSurfaceComponent`, `defineCatalogueManifest`, `composeCatalogue`, `rendererRegistrations`; boundary tests; snapshot gate. `shortlet-discovery/v1` and `shortlet-booking/v1` re-expressed as manifests with no custom components, producing **byte-identical** schemas. Platform `CatalogueRegistry` and the Weaver runtime fed from the same manifests; the `{ commerce }` flag replaced by pack registration (commerce stays unregistered) | none | 0 (independent of weaver-catalogues 02, but not run alongside it, because both rebuild `dist/client.js`) |
| **2 First typed components** | weaver-catalogues 04–07 built *in library format*: MoneyBreakdown (Tier 1, aliased `PriceBreakdown`), CommitmentSummary (`StayTicket`), DetailView (`UnitDetail`), ResultCard (`StayCard`), Comparison (`StayComparison`). Each Tier 2 candidate starts with a one-page paper check mapping commerce's existing presentation (`apps/web-agent/src/commerce-presentation.ts`) onto its slots, with no commerce code changed. If commerce does not fit, the component is built as a Tier 3 stays component and stays there until a second domain does fit. The four organizers are deleted; the gallery is added | same screens, now typed | 1 |
| **3 Platform tier** | Steps, StatusBanner, Deadline, PaymentHandoff, HandoffNotice, Receipt. The request, offer, payment and confirmation organizers are retired. `platform-common/v1` is proposed if a platform-owned surface needs it | same screens | 2; owner approves any new ID |
| **4 Second-domain proof** | A **test-only fixture pack** declares a manifest from the same archetypes with its own aliases, slot choices and mode, and passes composition, registration, cold-restore and fail-closed cross-mode tests (ADR 0107 consequences) | none (test only) | 2 |
| **5 First real new domain** | When the owner picks it: its ADR, manifests, Tier 3 components and promotions, designed against stays plus that domain | new domain | owner decision |
| Later | MCP Apps adapter; per-pack lazy renderers; A2UI v1.0 multi-catalogue surfaces once ADR 0069 adopts v1.0 | — | — |

Phase 1 is the one that matters for "manageable". After it, a new domain mostly adds configuration and a few components, without editing platform code or the shell.

## 11. Decisions (all accepted by the owner on 18 Nov 2026)

1. **Package and boundary.** A new Weaver-free `packages/surface-kit`, with the Weaver adapter in `apps/web-agent/src/catalogues/`. Props types are written beside the schema and kept equal by a type test, rather than adding a schema-to-type generator dependency. *Recommend: accept.*
2. **Names on the wire.** Use domain aliases (`StayCard` → `ResultCard@1`), not shared names. *Recommend: aliases*, because they keep ADR 0102's names and let each domain version on its own.
3. **Glossary.** Call it **Surface Catalogue** and **Surface Component** in docs and code, because commerce already uses "Catalogue" for products. *Recommend: accept;* add both to the platform `CONTEXT.md`.
4. **Catalogue granularity.** Keep one catalogue per domain stage (discovery, booking; cart, order), as ADR 0102/0103 already do, not one large catalogue per domain. *Recommend: keep.*
5. **`platform-common/v1`.** Propose `urn:chat-marketplace:platform/common/v1` only when a platform-owned surface (payment handoff, human handoff) needs it, in phase 3. *Recommend: defer the approval to phase 3.*
6. **Proving the second domain.** Use a test-only fixture pack, not commerce, so no commerce work starts while ADR 0104 holds. *Recommend: fixture pack.*
7. **Model-composed surfaces.** Keep surfaces pack-built and deterministic. Revisit only through a new ADR, for presentation-only layouts with no material actions. *Recommend: keep as is.*
8. **Minor-version rule.** Allow additive optional props within a catalogue major, protected by the stale-client fallback test. Everything else is a new major. *Recommend: accept.*
9. **Sequencing with weaver-catalogues.** Amend issues 04–07 so they build in the library format after phase 1, rather than building first and extracting later. *Recommend: amend;* this saves moving five components twice. The alternative is to finish 04–07 as planned and extract afterwards. It ships the typed screens sooner, but each component has to be moved and re-captured.
10. **Future domains now.** Reserve archetype names and keep the matrix in §7 current, but build no event, service or community component until the owner picks that domain. *Recommend: accept.*
11. **What counts as a second domain for promotion.** A built pack counts even while parked: commerce, checked on paper only. A test-only fixture pack does not count. *Recommend: accept.*

## 12. ADR verification checklist (for phase 1 and later reviews)

- [ ] No Weaver import in `packages/surface-kit`, `domains/*` or `packages/platform-core` (0081).
- [ ] Every composed catalogue is a single document; its `$id` equals `catalogId` equals the manifest ID; every ID was approved by the owner (0073, 0102).
- [ ] Every component has a complete `text()` fallback, tested on its fixtures (0074).
- [ ] No string literal copy in Tier 1 or Tier 2; all copy comes from `guest-content.ts` (0077).
- [ ] No arithmetic on money or dates in any renderer or helper (0077).
- [ ] Action names in emitted surfaces ⊆ manifest actions ⊆ pack `ActionSpec` names ∪ pack presentation events (0072, 0099).
- [ ] Unregistered packs' catalogues are absent from both registries (0104, 0107 decision 10).
- [ ] Gallery captures at 4 widths in light and dark, no overflow, targets ≥ 44px (0078).
- [ ] Snapshot gate green, fixture replay green, and `git revert` of the phase restores the previous render (0079).
