# Surface catalogue library: prior art and research notes

Prepared 18 Nov 2026 for `.scratch/surface-catalogue-library/analysis.md`.

**How each source was used.** Each entry is marked:
- **read**: the page or code was read in full or in large part;
- **snippets**: only search-result summaries were seen;
- **known**: a standard published work cited from general knowledge and not fetched this session. Check it before quoting.

## 1. The protocol and runtime we are bound by

### A2UI catalogues (a2ui.org) — read

Sources: <https://a2ui.org/concepts/catalogs/> (read in full) and <https://a2ui.org/guides/defining-a-catalog/> (first part read in full, the rest summarized by the fetcher).

- A catalogue has a URI `catalogId`, `components` (each one a JSON Schema keyed by its PascalCase name) and `functions`. v1.0 adds `instructions` for the agent's system prompt.
- **Catalogues are self-contained.** The defining guide says external `catalog.json` references are not allowed; `$ref` stays local or points at the allow-listed `common_types.json`.
- Composition happens at runtime, by loading several catalogues. In v0.9.1 each surface binds to one `catalogId`, which is fixed for the surface's lifetime. In v1.0 a component may carry its own `@catalogId`.
- Negotiation: the renderer sends `supportedCatalogIds` and the agent picks one, or sends no UI if none match.
- Put the version in the URI path (`v1/`, `v2/`) for breaking changes. The Basic Catalog has 18 components and 14 functions. Domain catalogues add components to the Basic set (the Google Maps example).
- The pages give no guidance on catalogue size.

Spec index pages (snippets): <https://a2ui.org/specification/v0.9.1-a2ui-extension-specification/>, <https://a2ui.org/specification/v0_9_1/json/client_capabilities.json>, <https://a2ui.org/specification/v1.0-a2ui/>.

### Weaver 0.2.1 (local code) — read

- `node_modules/@cylayo/weaver-core/dist/catalog/schema-validator.js:105` `referencesResolve`: a `$ref` resolves only against the registered document or a resource embedded in it by `$id`. This confirms the self-contained rule in our runtime.
- `node_modules/@cylayo/weaver-web/dist/renderers/RendererRegistry.d.ts`: renderers are keyed by `(catalogId, component)` in an immutable allow-list.
- `createBasicCatalogRendererRegistrations({ catalogId })` already stamps one renderer set onto any catalogue ID. The proposed `rendererRegistrations(manifest)` generalizes this existing pattern.
- The local Basic Catalog has 18 components and 14 functions (counted from `createBasicCatalogV091Registration()`), which matches a2ui.org.
- A scratch script (not kept) registered a Basic clone plus one shared card schema under a domain alias. Weaver accepted the catalogue and the runtime, validated good props, and rejected an extra prop and the un-aliased name (see analysis §4.1).

## 2. Domain-driven design (strategic)

- Evans, *Domain-Driven Design* (2003) — known. Covers bounded contexts, the context map, the shared kernel, published language, open host service, the anticorruption layer, separate ways, and generic versus core subdomains.
- Evans, *DDD Reference* (2015) — snippets (only the index came back): <https://domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf>.
- Pattern summaries — snippets: The Open Group, <https://pubs.opengroup.org/architecture/o-aa-standard/DDD-strategic-patterns.html>.
- Vernon, *Implementing Domain-Driven Design* (2013) and *DDD Distilled* (2016) — known.

What we take from it:
- The shared kernel must be **small** and changed only by agreement, because widening it couples the contexts.
- An anticorruption layer keeps the upstream model out of the downstream context.
- A design system is a generic subdomain, not a core domain.

## 3. Product lines and variability

- Parnas, "On the criteria to be used in decomposing systems into modules", CACM 1972 — known. Information hiding: a module's interface is its commonality and its secret is its variability.
- Coplien, Hoffman and Weiss, "Commonality and Variability in Software Engineering", IEEE Software 1998 — snippets: <https://courses.cs.duke.edu/compsci307d/current/readings/Commonality_and_Variability.pdf>. Defines a commonality as "an assumption held uniformly" across a set of objects.
- Clements and Northrop, *Software Product Lines* (2001); Pohl, Böckle and van der Linden, *Software Product Line Engineering* (2005) — known; secondary snippets at <https://rd.springer.com/content/pdf/10.1007/978-3-319-73897-0_11.pdf>. Domain engineering defines the commonality and variability, and each product reuses the domain assets.

What we take from it: name every variation point and keep them closed (a `variant` enum and optional slots), and scope the product line to the members we actually have.

## 4. Design systems

- Nathan Curtis, "Design System Tiers" (2019) — snippets: <https://medium.com/eightshapes-llc/design-system-tiers-2c827b67eae1> and <https://eightshapes.com/articles/design-system-tiers/>. A high-quality core maintained by an identifiable group, lower tiers for shared features, and clear criteria for promotion.
- Nathan Curtis, "The Fallacy of Federated Design Systems" — snippets: <https://nathanacurtis.substack.com/p/the-fallacy-of-federated-design-systems-23b9a9a05542>. A stable core can take federated contributions.
- Brad Frost, *Atomic Design* (2016); Alla Kholmatova, *Design Systems* (2017) — known.

## 5. Abstraction timing

- Sandi Metz, "The Wrong Abstraction" (2016) — snippets. "Duplication is far cheaper than the wrong abstraction." When an abstraction proves wrong, put the duplication back.
- The rule of three (Don Roberts, in Fowler's *Refactoring*) — snippets: <https://understandlegacycode.com/blog/refactoring-rule-of-three/>.
- John Ousterhout, *A Philosophy of Software Design* (2018) — known. "Design it twice"; deep modules. This matches ADR 0099 decision 7.

## 6. UI composition across service or domain boundaries

- Cam Jackson, "Micro Frontends", martinfowler.com (2019) — snippets: <https://martinfowler.com/articles/micro-frontends.html>.
- Michael Geers, *Micro Frontends in Action* (2020) — known.
- Secondary guidance (snippets): <https://packtpub.com/en-ca/product/building-micro-frontends-with-react-18-14-9781804610961/chapter/chapter-10-common-pitfalls-to-avoid-when-building-microfrontends/avoiding-the-overuse-of-shared-component-code>. Shared libraries should hold UI logic only; shared domain logic couples teams.
- Udi Dahan, "UI Composition Techniques for Correct Service Boundaries" (2012); Mauro Servienti, ViewModel composition — snippets: <https://particular.net/blog/secret-of-better-ui-composition>. Each service owns its slice of data, and a composition layer assembles the view.

## 7. Server-driven UI in production

- Yelp, "Keeping Server-Driven UI Consistent Across Platforms" (Apr 2026) — **read**: <https://engineeringblog.yelp.com/2026/04/keeping-server-driven-ui-consistent-across-platforms.html>.
  - One JSON interface definition per component generates the Kotlin, Swift, Python and TypeScript libraries.
  - Each component is versioned. Each client has a spec of the versions it supports, and the backend sends the newest version the client supports.
  - A breaking change bumps the major version, with a `migrate` backport for older clients.
  - Design tokens live in a separate repository.
- Airbnb, "A Deep Dive into Airbnb's Server-Driven UI System" (Ghost Platform, 2021) — **not read** (the fetch returned 403). Summary seen via InfoQ snippets: <https://www.infoq.com/news/2021/07/airbnb-server-driven-ui>. Typed sections are reused across layouts, and the backend controls layout, data and actions. Nothing seen confirms reuse across Airbnb's verticals.

## 8. Card and catalogue formats with versioning and fallback

- Microsoft Adaptive Cards — snippets:
  - <https://learn.microsoft.com/en-us/adaptive-cards/authoring-cards/universal-action-model>
  - <https://learn.microsoft.com/he-il/adaptive-cards/rendering-cards/implement-a-renderer>
  - <https://learn.microsoft.com/en-au/agents/design-guidelines/adaptive-cards-for-agent-design>
  - A card declares a schema `version` with `fallbackText`; elements declare `requires` (feature to minimum version) and a `fallback`; a host config JSON controls presentation.
- Vercel Labs json-render — snippets: <https://github.com/vercel-labs/json-render>. `defineCatalog` with Zod-typed props; the model "can only use components in your catalog"; the catalogue generates its own system prompt. This is relevant only if the model ever composes surfaces.

## 9. Agent-generated UI and other channels

- Google Research, "Generative UI: LLMs are Effective UI Generators" (2025) — snippets: <https://arxiv.org/pdf/2604.09577> and <https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/>.
  - Humans preferred generated UIs over markdown when speed was ignored.
  - The blog reports generation sometimes takes a minute or more, with occasional inaccuracies.
  - It does not fit material booking or payment surfaces under ADR 0073, 0077 and 0106.
- MCP Apps, SEP-1865 — snippets: <https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp> and <https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/>.
  - `ui://` resources of type `text/html;profile=mcp-app`, rendered in sandboxed iframes and negotiated as an extension.
  - This is a future channel adapter for the same HTML helpers (multi-domain issue 29).

## 10. What was not found

- No source gives a recommended catalogue size, or a number of components to expose to a model.
- No source confirmed that Airbnb shares sections across verticals.
- The original texts of Curtis, Metz, Evans and Clements and Northrop were not fetched; the claims above rely on summaries and general knowledge.
