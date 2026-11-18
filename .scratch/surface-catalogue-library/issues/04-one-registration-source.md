# One registration source; retire the `{ commerce }` flag

Status: ready-for-agent
Type: task
Blocked by: 03
Requested: 18 Nov 2026

## Why

Two places decide which catalogues are registered, and they disagree:

1. `createShortletWebRuntime` in `apps/local-guest/src/shortlet-runtime.ts` lists the shortlet registrations by hand and adds commerce when `options.commerce === true`.
2. The platform `CatalogueRegistry` defaults to short ids (`"discovery/v1"`, …).

ADR 0108 decision 4 and ADR 0107 decision 10 say the catalogue set is the set of the registered packs' catalogues, from one list.

## What to build

- **`createGuestWebRuntime({ catalogues, resourcePolicy?, safety?, onServerEvent? })`** in `apps/local-guest/src/shortlet-runtime.ts` (keep the file; rename it only if no import churn results):
  - `catalogues` is `readonly ComposedCatalogue[]`.
  - Register each `registration` in `additionalCatalogs`.
  - Register `rendererRegistrationsFor(composed, resourcePolicy)` for each.
  - Throw on duplicate ids (`catalogueIds`).
- **`createShortletWebRuntime(options)`** becomes `createGuestWebRuntime({ ...options, catalogues: SHORTLET_COMPOSED_CATALOGUES })`. **Remove the `commerce` option.** No production caller passes it today: `client.ts:2752` and `apps/web/src/weaver-host.ts:32` construct without it.
- **Commerce test.** Update `test/commerce-switch-catalogues.test.ts`. The two "commerce off" tests use `createShortletWebRuntime()`. The "commerce on" test uses `createGuestWebRuntime({ catalogues: [...SHORTLET_COMPOSED_CATALOGUES, ...COMMERCE_CATALOGS.map(basicEquivalentCatalogue)] })`. Its expectations are unchanged. This is a test edit, not commerce work; `commerce-catalogs.ts` stays untouched (ADR 0104).
- **Platform registry.** Add a test that registering `catalogueIds(SHORTLET_COMPOSED_CATALOGUES)` under owner `"shortlet"` in a `CatalogueRegistry` gives exactly the id set the Weaver runtime accepts (excluding the Basic id). Leave the `APPROVED_CATALOGUES` default in `surface.ts` as is (PRD "Legacy short ids"), with a one-line comment pointing to ADR 0108 phase 3.
- Rebuild `apps/local-guest/dist/client.js` (`npm run build`). Stage only `dist/client.js`, never the other `dist/*.js` (AGENTS.md).

## Acceptance criteria

- **AC1:** `createGuestWebRuntime` registers exactly the given catalogues and their renderers, and throws on a duplicate id.
- **AC2:** `createShortletWebRuntime()` accepts exactly the shortlet ids, and a commerce surface is refused (the existing ADR 0104 tests, unchanged in meaning).
- **AC3:** The commerce-enabled runtime built from explicit catalogues accepts every commerce surface message (the existing ADR 0103 test, now on the new API), and `commerce-catalogs.ts` is unchanged.
- **AC4:** `ShortletWebRuntimeOptions` no longer has `commerce`. A source scan finds no `commerce: true` passed to a guest runtime factory.
- **AC5:** The id set a `CatalogueRegistry` gets from `catalogueIds(SHORTLET_COMPOSED_CATALOGUES)` equals the custom id set the runtime accepts.
- **AC6:** The chat still renders and falls back as before: `test/weaver-failure-chromium.test.ts` passes solo, and `test/weaver-web-host.test.ts` passes.

## ADR compliance

| ADR | Constraint | Where |
| --- | --- | --- |
| 0108 | One registration source for platform and Weaver | AC1, AC5 |
| 0107 decision 10 / 0104 | An unregistered pack has no catalogues; commerce code untouched | AC2, AC3, AC4 |
| 0074 | Fail-closed rendering unchanged | AC6 |
| 0079 | Pure refactor; existing suites unchanged | AC2, AC6 |

## Comments

- Affected tests: `test/commerce-switch-catalogues.test.ts`, `test/platform-core-catalogue-registry.test.ts`, `test/weaver-web-host.test.ts`, `test/shortlet-catalog-validation.test.ts`, `test/surface-kit*.test.ts`, and `test/weaver-failure-chromium.test.ts` (real Chrome, solo, because `dist/client.js` is rebuilt).
- `test/apartment-commerce-free-closure.test.ts` must stay green. `shortlet-runtime.ts` currently imports `commerce-catalogs.ts` statically, and after this issue it should not. Run it.
