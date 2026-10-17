# ADR 0102, `shortlet-*` catalogue definitions and the runtime factory

Status: resolved
Type: task
Blocked by: 01
Requested: 6 Oct 2026

## Why

ADR 0081 deferred custom catalogues "until evidence shows that the Basic Catalog is insufficient". That evidence now exists in `apps/local-guest/src/client.ts`.

Four post-render organizers rebuild Weaver's output into guest-kit markup:
- `organizeUnitDetail`
- `organizeBookingTicket`
- `decorateDiscoveryCards`
- `decorateComparison`

Three of them find facts by label text (`findFact`), and the fourth by DOM position.

ADR 0073 already names the catalogues (`shortlet-discovery/v1`, `shortlet-booking/v1`) and their governance. This issue records the decision and builds the shared plumbing that issues 04–07 fill in. It adds no new components to any surface.

Weaver facts that shape the design (0.2.1, verified against the tag):
- **No fallback.** There is no cross-catalogue, wildcard or default renderer fallback. Lookup is by the surface's `catalogId` plus the component name. A missing renderer gives `RENDERER_NOT_FOUND`.
- **Mixing Basic and custom.** To mix Basic and custom components on one surface, the custom catalogue's schema must contain the Basic component schemas. `createBasicCatalogRendererRegistrations({ catalogId })` is then registered under the custom id.
- **No `defineCatalog` in 0.2.1.** Registrations are plain `CatalogRegistration { catalogId, schema }`.
- **Renderer API.** `additionalCatalogs` and `additionalRenderers` on `createBasicWebRuntime` accept both.

## What to build

- **ADR.** Write `docs/adr/0102-adopt-shortlet-discovery-and-booking-catalogues.md`. It covers:
  - **Evidence:** the four organizers and the label-prefix contract they depend on (`GUEST_FACT_LABELS`, `guestFact`).
  - **Identifiers:** the exact catalogue ids for `shortlet-discovery/v1` and `shortlet-booking/v1` under one platform namespace constant. Propose the namespace and confirm it with the user before committing. Don't invent it silently.
  - **Components:** the planned components and their props, as listed in issues 04–07.
  - **Composition:** each schema embeds the Basic Catalog components.
  - **Fallback:** an unsupported catalogue on an old client fails closed (ADR 0074).
  - **Review gates:** a new major version for a breaking change (ADR 0073).
  - **Supersession:** it amends 0081's deferral for these two catalogues only. The other three ADR 0073 catalogues stay deferred.
- **Catalogue module.** Add `apps/web-agent/src/shortlet-catalogs.ts`. It has no DOM and is safe on both server and client. It contains:
  - `defineShortletCatalog<TSchema>(schema)`, a typed identity helper that mirrors upstream `defineCatalog` (`cada149`), with a comment to swap it when Weaver publishes it
  - `SHORTLET_DISCOVERY_CATALOG` and `SHORTLET_BOOKING_CATALOG`, each a `CatalogRegistration`. Its schema is the Basic Catalog schema from `createBasicCatalogV091Registration()`, deep-cloned and re-identified to the new id, plus a `components` map that the later issues extend.

  This issue registers the catalogues with **no** custom components yet, so both are Basic-equivalent.
- **Runtime factory.** Add `apps/local-guest/src/shortlet-runtime.ts` exporting `createShortletWebRuntime(options)`. It wraps `createBasicWebRuntime` with:
  - `additionalCatalogs: [SHORTLET_DISCOVERY_CATALOG, SHORTLET_BOOKING_CATALOG]`
  - `additionalRenderers`: `createBasicCatalogRendererRegistrations({ catalogId, resourcePolicy })` for each shortlet id, plus the custom renderers exported from a new `apps/local-guest/src/shortlet-renderers.ts`, which starts empty

  It passes `basic.resourcePolicy` (the `safeImageResourceUrl` policy) to every registration.
- **Wire up.** Use the factory in `client.ts` (runtime creation, around line 2341) and in `apps/web/src/weaver-host.ts`. Rebuild `dist/client.js`.
- **Shared validation helper.** Add `validateShortletMessages(messages)` (test helper, or `apps/web-agent` if the server also uses it). It runs messages through a headless `createWeaverRuntime({ catalogs: [basic, discovery, booking] })` and returns the first failure.

## Acceptance criteria

- **AC1:** ADR 0102 exists, cites 0073, 0074, 0075, 0077, 0078 and 0081, and lists the exact catalogue ids. `shortlet-catalogs.ts` exports those ids from one constant, and no other source file repeats the literal id strings (source-scan test).
- **AC2:** Both catalogue schemas contain every Basic Catalog component, and a surface on either id that uses only Basic components validates and renders identically to the same surface on the Basic id. Use a happy-dom test with `createShortletWebRuntime`.
- **AC3:** Every builder fixture output in the repo validates with `validateShortletMessages`. Add `test/shortlet-catalog-validation.test.ts`, which later issues extend.
- **AC4:** A message that uses an unknown component, or a component with an extra or missing property, on a shortlet catalogue is rejected by `runtime.process`. It is not rendered (ADR 0073, 0075).
- **AC5:** A Basic-only runtime, standing in for a stale cached client, that receives a `shortlet-*` surface fails closed. The chat records `weaver-rendering-failure`, shows the textual fallback and keeps the conventional route link (ADR 0074). Run this in real Chromium, or happy-dom against `renderSurface`'s fallback path.
- **AC6:** The client and `weaver-host.ts` both construct through `createShortletWebRuntime`, and every existing Chromium suite passes unchanged.

## ADR compliance

| ADR | Constraint | Where |
| --- | --- | --- |
| 0081 | Custom catalogues need recorded insufficiency evidence. No Weaver types in authoritative packages. | ADR 0102 (AC1); module locations |
| 0073 | Platform-namespace ids; compile-time schemas; no dynamic schema; every outbound message validated. | AC1, AC3, AC4 |
| 0074 / 0068 | An unsupported catalogue fails closed to text plus a conventional route. | AC5 |
| 0075 | Typed and validated props only; strict resource policy. | AC4; `resourcePolicy` passed to every registration |

## Comments

- 17 Oct 2026: Owner approved `urn:chat-marketplace:shortlet` with exact IDs `urn:chat-marketplace:shortlet/discovery/v1` and `urn:chat-marketplace:shortlet/booking/v1`, subject to runtime/schema validation. Recorded in accepted ADR 0102 at `docs/adr/0102-adopt-shortlet-discovery-and-booking-catalogues.md`. Weaver 0.2.1 runtime registration accepts both exact IDs in focused tests.
- ADR number collision: accepted ADR 0096 is `export-payment-references-in-plaintext`; it is preserved unchanged. ADR 0102 is the next available number and this issue's catalogue decision is recorded there.

## Answer

Implemented on isolated branch `work/weaver-03`, based on canonical `main` at `e26e253`:

- `apps/web-agent/src/shortlet-catalogs.ts` defines the owner-approved namespace once, exports both exact IDs and Basic-equivalent catalogue registrations, and documents the Weaver 0.2.1 `defineCatalog` compatibility helper.
- `apps/local-guest/src/shortlet-runtime.ts` registers both catalogues and their Basic renderers under the configured resource policy; `shortlet-renderers.ts` is the custom-renderer extension point. Both `apps/local-guest/src/client.ts` and `apps/web/src/weaver-host.ts` use the shared factory. `apps/local-guest/dist/client.js` was rebuilt.
- `apps/web-agent/src/validate-shortlet-messages.ts` validates complete message sequences against Basic, discovery and booking registrations. `test/shortlet-catalog-validation.test.ts` covers source ID centralization, Basic schema/render parity, real application builder output for every guest stage through confirmed, invalid components/props, and a stale Basic-only runtime.
- `test/weaver-failure-chromium.test.ts` covers the visible fail-closed path: `weaver-rendering-failure`, textual fallback and conventional route link.
- Accepted ADR 0102 records the owner approval, namespace and exact IDs, catalogue evidence, planned components, governance, fallbacks, and applicable constraints. Existing ADR 0096's payment-reference decision is unchanged.

### Validation evidence

- `npm run check`: passed after the final full test run.
- `npm run build`: passed; client bundle rebuilt.
- Focused validation and Chromium fallback tests: 6 passed, 0 failed.
- `NODE_ENV=test npm test`: Phase 1: 1809 passed, 0 failed; Phase 2: 177 passed, 0 failed, 2 skipped.
- `git diff --check`: passed.
- Serial `capture-11.ts` run for all 21 screen groups: no horizontal overflow. Only reported controls were the payment choice page's hidden 1×1 native radio inputs; labels remain the intended controls. Generated captures/findings were restored because this issue adds no UI surface and requests no committed captures. The prescribed Bash wrapper could not start under WSL (missing Podman VHDX); the equivalent groups then ran successfully in separate native Windows processes.

### Definition of Done self-review

1. **Dedicated named acceptance tests:** AC1–AC5 each have named tests in `test/shortlet-catalog-validation.test.ts`; the Chromium fail-closed behavior is covered by `AC20 — A controlled Weaver rendering failure preserves a safe conventional fallback in real Chromium`.
2. **Named failure paths:** AC4 asserts rejection of unknown component, extra property and missing required property, and confirms no mount; AC5 asserts Basic-only rejection and Chromium fallback text, telemetry and route.
3. **Applicable ADRs read and recorded:** ADRs 0068, 0073–0081 (specifically 0073–0075, 0077–0081), plus existing ADR 0096 were checked. Constraints are recorded in ADR 0102 and the compliance table above.
4. **Dependencies:** the runtime factory only accepts options it uses; no unused injected dependencies were added.
5. **Policy and constants:** IDs and namespace are owner-approved; no new business policy, thresholds or strings were introduced.
6. **Sensitive data:** no credentials, restricted identity material, or bearer references were added to telemetry or logs.
7. **Validation:** `npm run check` and full `npm test` pass as recorded above.

Resolved after independent review and parent acceptance. Implementation commit: `b0c1454` (`feat(guest): add validated shortlet catalogue runtime`). Full validation evidence above applies to this exact candidate based on canonical main `e26e253`.
