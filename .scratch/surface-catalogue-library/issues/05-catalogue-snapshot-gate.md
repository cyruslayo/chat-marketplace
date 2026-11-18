# Catalogue snapshot gate and change classifier

Status: resolved
Type: task
Blocked by: 03
Requested: 18 Nov 2026

## Why

Because each catalogue embeds its components, changing a shared Surface Component changes the schema of every catalogue that uses it. ADR 0108 decision 6:
- an additive change is a minor version;
- anything else needs a new catalogue major;
- composed catalogues are snapshotted, and a non-additive diff under the same major fails the build.

Strict props (`additionalProperties: false`) mean even an additive change reaches tabs opened before the deploy. Those tabs must fall back safely (analysis §8).

## What to build

- **`classifyCatalogueChange(before, after)`** in `packages/surface-kit` returns `{ kind: "identical" | "additive" | "breaking", reasons: readonly string[] }`.
  - **Additive** means only:
    - a new component;
    - a new property that is not in `required`;
    - a new value appended to an enum of a property;
    - a raised `maxLength`, `maxItems` or `maximum`.
  - **Breaking** is everything else:
    - a removed component or property;
    - a new `required` entry;
    - a removed enum value;
    - a changed `type`, `const` or `$ref`;
    - a lowered bound;
    - any change to `functions` or `$defs` other than an addition.
  - Each reason names the JSON pointer it applies to.
- **`test/catalogue-snapshots.test.ts`**. For every composed catalogue the production composition exposes (`SHORTLET_COMPOSED_CATALOGUES` today), compare against `test/fixtures/catalogues/<id-slug>.json` (written in issue 03):
  - `identical` passes.
  - `additive` fails with a message to re-run with `UPDATE_CATALOGUE_SNAPSHOTS=1`. With the variable set, the snapshot is rewritten.
  - `breaking` fails, even with the variable set, unless the catalogue id's major differs from the snapshot's. In that case a new snapshot file is written next to the old one.
  - A snapshot file with no current catalogue fails, so retired catalogues are removed on purpose.
- **Stale-tab rule test.** Using issue 02's ProbeCard:
  - define `1.1.0` with one new optional prop;
  - compose `probe/v1` with `1.0.0` (old client) and with `1.1.0` (new server);
  - classify the change as additive;
  - check that an old-client runtime given a new-server message using the new prop rejects it and takes the text fallback (ADR 0074).
- **Document** the rule and the update variable in `packages/surface-kit/README.md`.

## Acceptance criteria

- **AC1:** `classifyCatalogueChange` returns `identical` for equal schemas and `additive` for each additive case listed, with a reason per change.
- **AC2:** `classifyCatalogueChange` returns `breaking` for each breaking case listed, with the JSON pointer in the reason.
- **AC3:** The snapshot test passes on the current tree with the issue-03 snapshots, unchanged.
- **AC4:** A simulated additive drift fails without `UPDATE_CATALOGUE_SNAPSHOTS` and is rewritten with it. Use a temporary snapshot directory, never the committed fixtures.
- **AC5:** A simulated breaking drift under the same id major fails even with the variable set, and succeeds only under a new major id.
- **AC6:** An orphan snapshot file fails the test.
- **AC7:** ProbeCard `1.0.0` → `1.1.0` classifies as additive, and an old-client runtime receiving the new prop falls back to complete text.

## ADR compliance

| ADR | Constraint | Where |
| --- | --- | --- |
| 0108 | Minor versus major rules; snapshot gate | AC1–AC6 |
| 0073 | A breaking change needs a new catalogue major | AC5 |
| 0074 | Stale clients fail closed to text | AC7 |
| 0079 | Replayable, reviewable contract changes | AC3, AC4 |

## Comments

- Affected tests: `test/catalogue-snapshots.test.ts`, `test/surface-kit*.test.ts`. This is the last phase-1 issue. After it, run the batch gate in `map.md` (check, `test:workers`, full `npm test`) before any merge.

- Commands run (worktree `chat-marketplace-surface-kit`, every command with `env -u LLM_API_KEY`):
  - `npx tsx --test test/catalogue-snapshots.test.ts test/surface-kit.test.ts test/surface-kit-boundary.test.ts test/surface-kit-weaver.test.ts test/shortlet-catalogue-manifests.test.ts test/guest-web-runtime.test.ts`: 35 tests, 35 pass, 0 fail (`catalogue-snapshots.test.ts` alone: 7 tests, 7 pass).
  - `npm run check`: clean.
- No client file changed in this issue, so `dist/client.js` was not rebuilt and no real-Chrome test was run.
- Classifier decisions inside the issue text:
  - Strictness: a changed `description` or any keyword that is not on the additive list is breaking, a removed required entry is breaking, and an added or removed keyword is breaking. The gate fails closed; a reviewed wording change needs a new major or, for an additive reviewer decision, widening the rule in a later issue.
  - Inside an existing `$defs` or `functions` entry only an appended `oneOf` or `anyOf` entry is allowed (that is how a new component joins `$defs.anyComponent`, and a new function joins `anyFunction`). A new property, an appended enum value or a raised bound inside a `$defs` or `functions` entry is breaking, per "any change to `functions` or `$defs` other than an addition".
  - When a change is breaking, `reasons` lists only the breaking changes; when additive, only the additive ones.
- The snapshot gate lives in `test/helpers/catalogue-snapshots.ts` (it needs `node:fs`, so not in the Weaver-free library). The "new major" rule in the issue needs a defined meaning, because the snapshot file name already contains the id major: a catalogue with no snapshot under its own id but with a lower-major snapshot of the same `urn:chat-marketplace:<namespace>/<name>` is a new major; it fails without `UPDATE_CATALOGUE_SNAPSHOTS=1` and is written next to the old file with it. The old major must stay in the catalogue list or its file is an orphan and fails (AC6).
- The test strips CR when it reads a snapshot (this checkout has `core.autocrlf=true`).
- Stale-tab rule (AC7): the new prop is rejected by `runtime.process` on the old client (strict props), and the client then mounts `mountGuestSurfaceOrFallback` with no rich attempt, which is exactly what `client.ts` does when `process` fails; the fallback keeps the complete text of the new definition (including the new prop) and the conventional route.
- Definition of Done: AC1–AC7 each have a dedicated named test with failure paths (each breaking case, the variable ignored for a breaking change, an orphan, a stale client). No invented policy string, id, copy or action name. ADR 0108 decision 6, 0073, 0074, 0079 are reflected.

## Answer

`classifyCatalogueChange` (in `packages/surface-kit`) and the snapshot gate (`test/catalogue-snapshots.test.ts` with `test/helpers/catalogue-snapshots.ts`) now fail a breaking change to a composed catalogue under an unchanged major, require `UPDATE_CATALOGUE_SNAPSHOTS=1` for an additive one and fail an orphan snapshot. The README documents the rule and the variable. A stale client falls back to complete text and the conventional route.
