# Weaver adapters and the ProbeCard alias proof

Status: resolved
Type: task
Blocked by: 01
Requested: 18 Nov 2026

## Why

A scratch script on 18 Nov 2026 showed that Weaver 0.2.1 registers and validates a shared component under a domain alias. No custom *renderer* has been registered in this repo yet (`SHORTLET_RENDERERS` is `[]`). This issue builds the two thin adapters and proves the full path with a test-only component before any production surface depends on it.

## What to build

- **Schema adapter** `apps/web-agent/src/catalogues/weaver-catalogues.ts` (no DOM):
  - `composeWeaverCatalogue(manifest)` calls `composeCatalogueSchema(manifest, createBasicCatalogV091Registration().schema)` and returns `{ composed: ComposedCatalogue, registration: CatalogRegistration }`.
  - `basicEquivalentCatalogue(registration)` wraps an existing Basic-clone `CatalogRegistration` (for example commerce's) as a `ComposedCatalogue` with no components. It must not modify the registration.
- **Renderer adapter** `apps/local-guest/src/catalogue-renderers.ts`:
  - `rendererRegistrationsFor(composed, resourcePolicy)` returns `createBasicCatalogRendererRegistrations({ catalogId, resourcePolicy })` plus one `RendererRegistration` per alias.
  - Each alias renderer:
    1. reads the hydrated `properties`;
    2. calls the definition's `html(props)`;
    3. parses the result through a `<template>` in `input.document`, as `replaceWithKitMarkup` does in `client.ts`;
    4. wires every element carrying `data-surface-action="<actionProperty>"` to `interactions.dispatchAction(actionProperty)` on click.
  - It renders nothing executable. Scripts and inline handlers in the helper output are a test failure.
- **Test-only component** `test/fixtures/surface-kit/probe-card.ts`:
  - `ProbeCard`, tier 2, version `1.0.0`.
  - Required `title`; optional slots `facts` (array of strings) and `badge` (`{ label, tone: "positive"|"neutral"|"caution" }`); one `primaryAction` (`common_types.json#/$defs/Action`).
  - `html` escapes every value with the kit's `escapeHtml` and uses kit classes only.
  - `text` returns every value in reading order.
  - It is never imported by production code.
- **Test-only manifest:**
  - id `urn:chat-marketplace:test/probe/v1` (test namespace; never registered in production);
  - aliases `ProbeStayCard` (slot `badge: "absent"`) and `ProbeOtherCard` (all slots optional).
- **Boundary:** extend `test/surface-kit-boundary.test.ts` so that only these two adapter modules, and test files, import both `packages/surface-kit` and `@cylayo/weaver-*`.

## Acceptance criteria

- **AC1:** The probe manifest composes and registers in `createWeaverRuntime` and in `createBasicWebRuntime`. `RendererRegistry.has(id, alias)` is true for both aliases and for every Basic component.
- **AC2:** On `ProbeStayCard`:
  - a valid `ProbeStayCard` message is accepted;
  - a `badge` prop is rejected, because the slot is absent;
  - an extra `nightlyKobo` prop is rejected;
  - the un-aliased name `ProbeCard` is rejected.
- **AC3:** In happy-dom, a rendered `ProbeOtherCard`'s markup equals the parsed output of `html(props)` for the same props. A value containing `<script>` and `"` renders as text.
- **AC4:** Clicking the element marked for `primaryAction` dispatches exactly one server event with the action name from the message.
- **AC5:** A Basic-only runtime (a stale client) given a probe surface fails closed. The fallback path keeps the complete `text(props)` output and the conventional route (ADR 0074). Use the same fallback route that `test/shortlet-catalog-validation.test.ts` AC5 uses.
- **AC6:** `basicEquivalentCatalogue` of a commerce registration returns the same schema object contents and no components. `commerce-catalogs.ts` is unchanged (`git diff` is empty for it).
- **AC7:** Only the two adapter modules pair surface-kit with Weaver outside tests (boundary test).

## ADR compliance

| ADR | Constraint | Where |
| --- | --- | --- |
| 0108 | Renderers are thin adapters over the kit helper; one registration per alias | AC1, AC3 |
| 0081 | Weaver stays behind adapters | AC7 |
| 0073 / 0075 | Strict props; escaped values; nothing executable | AC2, AC3 |
| 0074 | A stale client falls back to complete text and a route | AC5 |
| 0104 | Commerce code untouched | AC6 |

## Comments

- Affected tests: `test/surface-kit*.test.ts`, `test/shortlet-catalog-validation.test.ts`. This issue does not rebuild `dist/client.js` unless `client.ts` changes, and it should not change it.

- Commands run (worktree `chat-marketplace-surface-kit`, every command with `env -u LLM_API_KEY`):
  - `npx tsx --test test/surface-kit.test.ts test/surface-kit-boundary.test.ts test/surface-kit-weaver.test.ts test/shortlet-catalog-validation.test.ts test/weaver-dependency-boundary.test.ts test/apartment-commerce-free-closure.test.ts test/guest-identity-assurance.test.ts test/redact-platform-ids-generators.test.ts test/commerce-ops-import-boundary.test.ts`: 101 tests, 101 pass, 0 fail.
  - `npm run check`: clean.
  - `git diff 69c9ac4 -- apps/web-agent/src/commerce-catalogs.ts`: empty (AC6).
- `apps/local-guest/src/client.ts` is unchanged and the new adapters are not imported by any client or production module yet, so `dist/client.js` was not rebuilt and `test/weaver-failure-chromium.test.ts` was not run for this issue (the issue's own Comments say it should not change `client.ts`; the PRD lists 02 only "if `client.ts` changes"). Issue 04 rebuilds the client and runs it.
- Weaver 0.2.1 findings: the alias renderer receives hydrated `properties` as plain props; Weaver recognises `primaryAction` as an action property from its `common_types.json#/$defs/Action` ref, so `interactions.dispatchAction("primaryAction")` yields one `WebServerEventHandoff` whose `message.action.name` is the event name. A Basic-only runtime refuses `createSurface` for the unknown catalogue id, and the existing `mountGuestSurfaceOrFallback` then shows `definition.text(props)` and the conventional route.
- Defence in depth (not in the issue text): the alias renderer drops markup that carries a `<script>`, `<iframe>`, `<object>`, `<embed>`, an `on*` attribute or a `javascript:` value and renders `text(props)` instead, so a defective kit helper fails closed (ADR 0075). Tested in AC3.
- AC7 pairing scan: a module counts as pairing when it imports a path containing `surface-kit` and a `@cylayo/weaver-*` or `@weaver/*` package. Type-only imports count. Issue 04 must therefore import `ComposedCatalogue` into `shortlet-runtime.ts` through an adapter re-export, not from `packages/surface-kit` directly, and issue 03's `shortlet-catalogs.ts` must import `CatalogRegistration` and the manifest helpers without importing Weaver.
- Test-only files added: `test/fixtures/surface-kit/probe-manifest.ts` (id `urn:chat-marketplace:test/probe/v1`, never registered in production) and `test/surface-kit-weaver.test.ts`. `ProbeCard` itself was added in issue 01.
- Definition of Done: AC1–AC7 each have a dedicated named test, with the failure paths (absent slot, extra property, un-aliased name, missing property, stale runtime, executable markup, non-platform id). No injected dependency is unused. No catalogue id other than the test id, no copy and no action name was invented. ADR 0108, 0081, 0073, 0075, 0074 and 0104 are reflected in the code.

## Answer

The two Weaver adapters exist and the alias path is proven with the test-only `ProbeCard`: `composeWeaverCatalogue` and `basicEquivalentCatalogue` (`apps/web-agent/src/catalogues/weaver-catalogues.ts`), and `rendererRegistrationsFor` (`apps/local-guest/src/catalogue-renderers.ts`). No production code uses them yet.
