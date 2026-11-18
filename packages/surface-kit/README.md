# surface-kit

The Weaver-free library behind the Surface Catalogue Library (ADR 0108). It imports nothing outside its own `src/`: no `domains/*`, `apps/*`, `packages/platform-core` or `@cylayo/weaver-*` (`test/surface-kit-boundary.test.ts`). It also uses no `node:*` module, so it can ship in the Worker bundle and in the client.

## Surface Component

A reusable UI component, defined once with `defineSurfaceComponent`:

- a strict props schema: draft 2020-12, `additionalProperties: false`, with `component` and `id` properties. `$ref` may point only at `common_types.json#/$defs/...` or at a local `#/$defs/...`;
- a `Props` interface written beside the schema. A test calls `assertPropsMatchSchema` (`test/helpers/surface-kit-props.ts`) to keep the two equal;
- one `html(props)` kit helper, shared by the chat and the no-JS page. It must escape every value (ADR 0075);
- a complete `text(props)` fallback (ADR 0074);
- valid and invalid fixtures;
- a semver version.

The optional properties are the component's **slots**. **The library holds no copy and computes nothing** (ADR 0077): every visible string arrives through props.

### Tiers

| Tier | Owner | Holds |
| --- | --- | --- |
| 0 | Weaver | The Basic Catalog (vendor) |
| 1 | Platform | Components with no domain vocabulary and no copy |
| 2 | Platform | Archetypes shared by two or more real domains, varied only by named optional slots and shape-named enums |
| 3 | A pack | Domain-only components |

Tiers 1 and 2 hold no domain vocabulary. `findGlossaryTerms(schema, terms)` finds property names and enum values that match a glossary term list, for the lint that phase 2 runs over the real schemas.

## Catalogue Manifest

`defineCatalogueManifest` declares one catalogue: an owner-approved id (`urn:chat-marketplace:<namespace>/<name>/v<major>`), the base (`basic/v0.9.1`), the components it uses under PascalCase domain aliases with a pinned major and a slot choice (`required`, `optional` or `absent` per optional property), and its allow-listed action event names.

`composeCatalogueSchema(manifest, baseSchema)` composes a manifest into one self-contained A2UI v0.9.1 schema. It is pure: it deep-copies the base and never mutates it. It sets `$id` and `catalogId`, adds each alias under `components` and to the `$defs.anyComponent` union, and applies the slot choices. `catalogueIds(composed)` lists the ids and rejects duplicates.

Weaver binds one catalogue to a surface and resolves `$ref` only inside the registered document, so a catalogue cannot reference shared components at run time. Composition at build time is how a shared component reaches several catalogues.

See `docs/adr/0108-compose-domain-surface-catalogues-from-a-shared-library.md` and `.scratch/surface-catalogue-library/`.

## Versioning and the snapshot gate

A catalogue embeds its components, so changing a shared Surface Component changes the schema of every catalogue that uses it (ADR 0108 decision 6).

- **Additive** is a minor version of the component and keeps the catalogue id: a new component, a new optional property, an enum value appended, a raised `maxLength`, `maxItems` or `maximum`, a new `$defs` or `functions` entry, or an alternative appended to a `oneOf` or `anyOf` (how a component joins the `anyComponent` union).
- **Anything else is breaking** and needs a new catalogue major (`.../v2`) after ADR 0073 review: a removed component, property or enum value, a new `required` entry, a changed `type`, `const` or `$ref`, a lowered bound, a changed `$defs` or `functions` entry, or any other changed keyword (a description counts: the gate fails closed).
- `classifyCatalogueChange(before, after)` returns `identical`, `additive` or `breaking`, with one reason per change that starts with its JSON pointer.
- `test/catalogue-snapshots.test.ts` compares every composed catalogue with its snapshot in `test/fixtures/catalogues/<id-slug>.json`. An additive change fails until the snapshot is rewritten on purpose with `UPDATE_CATALOGUE_SNAPSHOTS=1`. A breaking change under the same id major fails even then; publish it under a new major id and the new file is written next to the old one. A snapshot with no current catalogue (an orphan) fails, so a retired catalogue is removed on purpose.
- Strict props (`additionalProperties: false`) mean even an additive change is rejected by a tab opened before the deploy. That tab falls back to the complete `text(props)` and the conventional route (ADR 0074); the test in `catalogue-snapshots.test.ts` covers it.

```bash
UPDATE_CATALOGUE_SNAPSHOTS=1 npx tsx --test test/catalogue-snapshots.test.ts
```
