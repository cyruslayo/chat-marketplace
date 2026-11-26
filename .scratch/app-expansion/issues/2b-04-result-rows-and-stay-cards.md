# Phase 2b-04: Port result rows, list rows, view switch and stay cards

Status: ready-for-agent
Type: task
Blocked by: 07, 2b-01

## Why

Port discovery stay cards (`.ui-stay-card*` including the 44px title-link defect fix), compact result rows (`.ui-result-rows` / `.ui-result-row*`), list rows (`.ui-list*`), and segmented/view-switch controls (`.ui-segmented`) to the pinned round-12 [bundle.css](../design/round-12/bundle.css).

## What to build

- Port `.ui-stay-card*` (including `.ui-stay-card__title` `min-height: 44px; margin-block: -6px`, `.ui-stay-card__label`, `__body`, `__facts`, `__total`), `.ui-result-rows` / `.ui-result-row*` (`--muted`, `--no-thumb`, `__next`), `.ui-list*` (`__row--static`, `__aside--money`), and `.ui-segmented` (keeping radio support and adding `<a>` link styles for view switch).
- Preserve `.stay-card` and `.stay-grid` client hooks (`test/guest-retired-classes.test.ts`).
- Keep existing `.listing-gallery*` and `.ui-compare*` code classes (do not introduce `xk-gallery*`, `xk-viewer*`, or `xk-compare` from `xenia-kit.css`).
- Note: `Save` / `Saved` controls on stay cards and the Find view switch routes belong to Phase 3/5 and are **not** added here.
- Serial files: `apps/web/src/shortlet-foundations.css`, `apps/local-guest/src/guest-kit.ts`, `apps/local-guest/src/listing-gallery.ts`.

## Acceptance criteria

- AC1: `.ui-stay-card__title` measures >=44px tall at all widths (kit defect fixed); stay card count badge (`1 / 7`) and Demo listing label remain legible in light and dark themes.
- AC2: `.ui-result-row`, `.ui-list__row`, and `.ui-segmented` options all measure >=44px tall with zero text clipping at 320px.
- AC3: `.stay-card` and `.stay-grid` hooks remain intact for the discovery client; retired `.stay-result` stays absent.
- AC4: Captures at 320/390/768/1280 light and dark under `screenshots/2b-04/` and `capture-11-all.sh` pass with zero overflow and zero targets <44px.

## Integrity checks (`kickoff.md` §4)

- **I1 (Fact map):** Discovery card, result row, and gallery facts trace to `DiscoveryArtifactProjection` and `UnitDetailArtifact` in `fact-map.md`; no unbuilt `Save` button added.
- **I2 (Token parity):** Semantic tokens only; zero hex outside the token block.
- **I3 (Class parity):** Matches `class-map.md`; zero `xk-*`/`bd-*` classes in `apps/`; retired `.stay-result` absent.
- **I4 (Copy provenance):** Existing `guest-content.ts` / `listing-gallery.ts` strings only; no unapproved `New`/`Brand` copy (`Save`/`Saved`, `Photo 1 of 7`, `All-in · 30 nights` mismatches stay out unless approved).
- **I6 (Chat and page agree):** Discovery cards and unit rows use the same kit helpers across chat and `/stays/search`.
- **I8 (Captures):** 320/390/768/1280 light & dark + `capture-11-all.sh` pass.
- **I10 (Scope):** Stays only; commerce stays off.

## ADR compliance

0015, 0066, 0077, 0078, 0102, 0105, 0108.

## Tests

`npm run check`, `test/guest-retired-classes.test.ts`, discovery/search/gallery tests, and `capture-11-all.sh`. Record exact commands, counts, and capture findings in `## Comments`.

## Comments
