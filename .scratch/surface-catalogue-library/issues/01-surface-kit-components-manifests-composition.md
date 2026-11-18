# `packages/surface-kit`: components, manifests and composition

Status: ready-for-agent
Type: task
Blocked by: none
Requested: 18 Nov 2026

## Why

ADR 0108 defines each Surface Component once and builds each domain's Surface Catalogue from a Catalogue Manifest at build time. Two Weaver 0.2.1 facts force this:
- a catalogue must be one self-contained document (`referencesResolve`);
- a surface binds to one catalogue.

This issue builds the Weaver-free core that every later issue uses. It changes no runtime behaviour.

## What to build

Create `packages/surface-kit/src/` (plain source folder, imported by relative path like `packages/platform-core`) with `index.ts` as its only public module. Export:

- **`defineSurfaceComponent(definition)`**
  - Takes `{ name, version: "<major>.<minor>.<patch>", tier: 1 | 2 | 3, schema, html(props), text(props), fixtures: { valid: [...], invalid: [...] } }`.
  - `schema` is a draft 2020-12 JSON Schema object with:
    - `additionalProperties: false`
    - `properties.component`
    - `properties.id`
    - only these `$ref` targets: `common_types.json#/$defs/...` and local `#/$defs/...`
  - It throws when:
    - `additionalProperties` is missing or not `false`
    - `$ref` points elsewhere
    - the version is not semver
    - a fixture is not valid JSON
  - It returns a frozen definition.
  - Optional properties (those not in `required`) are the component's **slots**.
- **`defineCatalogueManifest(manifest)`**
  - Takes `{ id, owner, base: "basic/v0.9.1", components: Record<alias, { component, major, slots?: Record<slot, "required"|"optional"|"absent"> }>, actions: readonly string[] }`.
  - It throws when:
    - `id` does not match `^urn:chat-marketplace:[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*\/v[1-9][0-9]*$`
    - an alias is not PascalCase, is `Surface`, starts with `a2ui` (any case), or collides with a name in the base component list passed in later
    - `major` differs from the component's version major
    - a slot name is not an optional property of that component
    - `actions` contains duplicates
- **`composeCatalogueSchema(manifest, baseSchema)`**
  - A pure function returning a new JSON object. It never mutates `baseSchema`.
  - Deep-clone `baseSchema`.
  - Set `$id` and `catalogId` to `manifest.id`.
  - Add each alias to `components`, with `properties.component.const` set to the alias.
  - Apply the slot choice: `absent` deletes the property; `required` appends it to `required`.
  - Throw if an alias collides with a base component name.
  - Composing a manifest with no components returns a schema deep-equal to `baseSchema` with only `$id` and `catalogId` changed.
- **`catalogueIds(composed)`**: the ids of a list of composed catalogues, in order, with duplicates rejected.
- **Types**: `SurfaceComponentDefinition<TProps>`, `CatalogueManifest`, `ComposedCatalogue` (`{ manifest, schema, components: readonly { alias, definition }[] }`), `SlotChoice`. Use no `any` (coding standards). Use `unknown` plus guards where JSON is read.
- **Props type rule** (PRD): each component exports a `Props` interface written beside its schema. A type-level test helper `assertPropsMatchSchema<...>()` checks this in the test files. Keep it a test helper, not shipped code.
- **Glossary-leak lint helper**: `findGlossaryTerms(schema, terms)` returns property names or enum values that match a term list. It is case-insensitive and splits camelCase into words. It is used by phase 2's lint test. Here, prove it on a fixture only.

Also add:
- `test/surface-kit-boundary.test.ts`: no file under `packages/surface-kit/src` imports `domains/`, `apps/`, `packages/platform-core`, `@cylayo/weaver-*` or `@weaver/*`. Reuse the source-walking approach in `test/weaver-dependency-boundary.test.ts`; extract a shared helper under `test/helpers/` rather than copying it (AGENTS anti-pattern 4).
- `test/surface-kit.test.ts`: one `test()` per acceptance criterion.
- A short `packages/surface-kit/README.md`: what a Surface Component and a Catalogue Manifest are, the tiers, and a pointer to ADR 0108.

## Acceptance criteria

- **AC1:** `defineSurfaceComponent` accepts a valid definition and throws for:
  - a missing or `true` `additionalProperties`
  - a foreign `$ref`
  - a non-semver version
  - a `component` property that is missing
- **AC2:** `defineCatalogueManifest` throws for:
  - a malformed id
  - a non-PascalCase, reserved or `a2ui`-prefixed alias
  - a major mismatch
  - an unknown or non-optional slot
  - duplicate actions
- **AC3:** `composeCatalogueSchema` with an empty `components` map returns a schema deep-equal to the base with only `$id` and `catalogId` changed, and leaves the base object unchanged (checked with a frozen deep copy).
- **AC4:** Composing a manifest that aliases a fixture component:
  - adds the alias under `components` with `component.const` equal to the alias;
  - removes `absent` slots;
  - adds `required` slots to `required`;
  - throws when the alias collides with a base component name.
- **AC5:** `catalogueIds` returns ids in order and throws on a duplicate id.
- **AC6:** `findGlossaryTerms` finds a camelCase property such as `nightlyKobo` and an enum value such as `"stay"` from a fixture term list, and returns nothing for a neutral fixture.
- **AC7:** No file under `packages/surface-kit/src` imports domains, apps, platform-core or Weaver (boundary test).

## ADR compliance

| ADR | Constraint | Where |
| --- | --- | --- |
| 0108 | One definition per component; build-time composition; slots, not domain enums | AC1–AC4, AC6 |
| 0081 | No Weaver types in the library | AC7 |
| 0073 | Strict, closed schemas; namespaced ids only | AC1, AC2 |
| 0077 | The library holds no copy (definitions take copy through props) | README rule; enforced per component from phase 2 |

## Comments
