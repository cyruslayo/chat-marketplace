# Follow-up B: Wrap the 9 typed shortlet components as Tier 3 manifests

Status: resolved
Type: task
Blocked by: Follow-up A (D33, D34)

## Why

ADR 0108 decision 2 with the owner's D34: the 9 typed components in `shortlet-catalogs.ts` become Tier 3 `SurfaceComponentDefinition`s on `v1`, preserving 100% wire byte-identity for open chats.

## What to build

- Adapt `96072c1` + `e97d11f` from `feat/surface-kit-phase-1` (read blobs with `MSYS_NO_PATHCONV=1 git cat-file -p`, resolve against the current code, never merge that branch):
  - Convert the 9 schemas in `apps/web-agent/src/shortlet-catalogs.ts` into Tier 3 `SurfaceComponentDefinition`s with `text()` fallbacks and fixtures.
  - Populate `manifest.actions` with all 16 emitted events.
  - Compose both catalogues (`shortlet-discovery/v1`, `shortlet-booking/v1`) via `composeWeaverCatalogue`.
- Prove wire byte-identity of both catalogues against the pre-change output on this branch (recorded dumps in the Comments).
- Keep every fail-closed guard (`STALE_SURFACE` / `ARTIFACT_MISMATCH`) intact. No behaviour or copy change.

## Acceptance criteria

- AC1: The emitted `v1` wire bytes are identical before and after the wrap, for both catalogues.
- AC2: Each of the 9 components has a `text()` fallback and a fixture; all 16 emitted events appear in `manifest.actions`.
- AC3: The cold-restore journey (`test/assistant-cold-journey.test.ts`, assistant enabled, fresh `LocalGuestApp` before every event) still passes, and the criteria strip still returns on assistant responses.

## ADR compliance

0073, 0108 (decisions 2 and 6), 0106, 0102.

## Tests

`npm run check`, the catalogue byte-identity check, `test/assistant-cold-journey.test.ts`, the affected `shortlet-catalog*` tests. Record exact commands and counts in `## Comments`.

## Comments

- 27 Nov 2026. Cherry-picked `96072c1` (resolved) then `e97d11f` (resolved) from `feat/surface-kit-phase-1` onto `feat/app-expansion-02b` (from 02a). Landed as `939513b` and `a9eaadf`. The branch was never merged.
- Resolution notes. The source commits predate the typed components (their manifests are empty and their fixtures Basic-only), so the conflict resolution keeps both sides: the nine schemas stay byte-for-byte (same `componentSchema` builder, same insertion order), now wrapped as Tier 3 `SurfaceComponentDefinition`s (version 1.0.0, `html`/`text` plain fallbacks over escaped display props only — the live chat and page markup still comes from the trusted DOM renderers until Follow-up C wires host-aware per-alias renderers, so no markup or copy is invented here). The two fixture snapshots under `test/fixtures/catalogues/` were regenerated from the composed catalogues (they now carry the typed components, >50 KB each). The five web-agent event constants moved into leaf `*-actions.ts` modules (`discovery`, `unit-detail`, `request-draft`, `draft-replacement`, `booking-contract`) so the manifests can allow-list them without an import cycle; each a2ui file re-exports its constants unchanged, so every existing importer keeps working. `e97d11f`'s Basic-clone wire comparison was resolved to a deep-equal against the committed snapshot plus the recorded SHA-256 proof, since the pre-change construction (which included the 9 components) no longer exists in code.
- Wire byte-identity (AC1). SHA-256 of `JSON.stringify` of each catalogue export, identical at the pre-change commit `34a1373` (detached) and after the wrap:
  - `shortlet-discovery/v1`: `a2bcc2f865e7509a40f861618f6c1df5226d2896766cdf1ec73bcc7de11361d4`
  - `shortlet-booking/v1`: `44e35c3e38995d661fea1b9096f983152ae24025763f1229461feefd9335e295`
  - Commands: `set NODE_ENV=test&& npx tsx dump-catalogues.mts` (untracked helper at the worktree root; deleted after Follow-up C).
- Commands and counts (all with `set NODE_ENV=test&&`):
  - `npm run check` — clean (exit 0), run before and after the test rewrite.
  - `npx tsx --test test/shortlet-catalogue-manifests.test.ts` — 5 pass, 0 fail (after the 96072c1 resolution and again after the e97d11f resolution).
  - `npx tsx --test test/surface-kit.test.ts test/surface-kit-boundary.test.ts test/surface-kit-weaver.test.ts test/discovery-a2ui.test.ts test/commerce-switch-catalogues.test.ts test/assistant-cold-journey.test.ts` — 43 pass, 0 fail (the cold-restore journey, assistant enabled, ran green against the composed catalogues; the criteria strip projection is exercised by that suite).
  - `npx tsx --test test/surface-kit.test.ts test/surface-kit-boundary.test.ts test/surface-kit-weaver.test.ts test/weaver-dependency-boundary.test.ts test/assistant-cold-journey.test.ts` — 27 pass, 0 fail (post-e97d11f re-run).
- Fail-closed guards untouched: `validate-shortlet-messages` and the manifest test's AC4 prove unknown components still fail closed; the `ARTIFACT_MISMATCH` / `STALE_ACTION` guards in `apps/web/src/*-actions.ts` were not modified (only re-exported constants).
- Held back: nothing from the issue scope. The glossary Tier 1/2 renames remain deferred to `v2` per D34; no catalogue id changed, no copy changed (the fallback `html`/`text` emit props only, no new strings).