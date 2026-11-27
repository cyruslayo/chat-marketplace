# Follow-up A: Port packages/surface-kit and the Weaver 0.3.1 adapters

Status: resolved
Type: task
Blocked by: 02 (D33, D35), 2b-06

## Why

Issue 02 recommended landing `feat/surface-kit-phase-1`'s surface-kit foundation as reviewed cherry-picks instead of a merge. The owner accepted (D33: after 2b-05/2b-06, before Phase 3; D35: per-alias host-aware renderers; D36: the source branch stays unmerged).

## What to build

- Cherry-pick `dbc13d2` + `b629535` from `feat/surface-kit-phase-1` (read blobs with `MSYS_NO_PATHCONV=1 git cat-file -p`, resolve against the current code, never merge that branch):
  - `packages/surface-kit` (Weaver-free, ADR 0081) with `ProbeCard`.
  - `test/surface-kit*.test.ts`.
  - `apps/web-agent/src/catalogues/weaver-catalogues.ts` updated to Weaver `0.3.1` `defineCatalog(asCatalogSchema(...))`.
  - `apps/local-guest/src/catalogue-renderers.ts` extended with optional custom-renderer override support (`rendererRegistrationsFor` accepts per-alias host-aware renderers for the relationship/policy/callback components — D35).
- Prove wire byte-identity of both catalogues (`shortlet-discovery/v1`, `shortlet-booking/v1`) against the pre-change output on this branch.
- Keep every fail-closed guard (`STALE_SURFACE` / `ARTIFACT_MISMATCH`) intact.

## Acceptance criteria

- AC1: `packages/surface-kit` imports nothing from Weaver (`grep` gate) and its tests pass.
- AC2: The emitted `v1` catalogue wire bytes are identical before and after (recorded with sample wire dumps in the issue Comments).
- AC3: The cold-restore journey (`test/assistant-cold-journey.test.ts`, assistant enabled, fresh `LocalGuestApp` before every event) still passes, and the criteria strip still returns on assistant responses.
- AC4: No behaviour or copy change; no new catalogue ID (ADR 0073).

## ADR compliance

0073, 0081, 0102, 0106, 0108.

## Tests

`npm run check`, the new `test/surface-kit*.test.ts`, the catalogue byte-identity check, `test/assistant-cold-journey.test.ts`. Record exact commands and counts in `## Comments`.

## Comments

- 27 Nov 2026 (resolved on `feat/app-expansion-02a`, from `feat/app-expansion-2b-06`): `git cherry-pick dbc13d2` (landed as `dd558e6`) conflicted only in `test/weaver-dependency-boundary.test.ts` — resolved by taking the pick's `sourceFiles` import from `test/helpers/source-files.ts` and the current 0.3.1 pin title, dropping the now-shared inline copy. `git cherry-pick b629535` applied cleanly (landed as `cd27d7f`). `feat/surface-kit-phase-1` itself was never merged (D36).
  - Wire byte-identity (AC2): SHA-256 of `JSON.stringify` of each catalogue, dumped before (`34a1373`) and after (`cd27d7f`) — `shortlet-discovery/v1` `a2bcc2f865e7509a40f861618f6c1df5226d2896766cdf1ec73bcc7de11361d4`, `shortlet-booking/v1` `44e35c3e38995d661fea1b9096f983152ae24025763f1229461feefd9335e295`. Identical.
  - `npm run check` = clean (exit 0).
  - `npx tsx --test test/surface-kit.test.ts test/surface-kit-boundary.test.ts test/surface-kit-weaver.test.ts test/weaver-dependency-boundary.test.ts` = 22 pass, 0 fail (AC1: the boundary gate proves `packages/surface-kit` is Weaver-free).
  - `npx tsx --test test/assistant-cold-journey.test.ts` = 4 pass, 0 fail (AC3: cold restore before every event, criteria strip intact).
  - Every command ran with `set NODE_ENV=test&&` (global `NODE_ENV=production` on this machine otherwise fails fixture boot).
