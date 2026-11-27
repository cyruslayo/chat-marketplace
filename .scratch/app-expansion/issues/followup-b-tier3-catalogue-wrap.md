# Follow-up B: Wrap the 9 typed shortlet components as Tier 3 manifests

Status: ready-for-agent
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
