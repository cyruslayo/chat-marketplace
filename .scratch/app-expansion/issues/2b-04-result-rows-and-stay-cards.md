# Phase 2b-04: Port result rows, list rows, view switch and stay cards

Status: resolved
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

| ADR | Constraint imposed | Affected acceptance criterion / code path |
| --- | --- | --- |
| 0015 | All-In Stay Total leads on stay cards and result rows; separate deposit preserved | AC1, I1 / `stayCardInnerHtml`, `resultRowPartsHtml` (`guest-kit.ts`) |
| 0066 | Neighbourhood-level location shown before payment without revealing address | I1 / `stayCardInnerHtml` `.ui-stay-card__where` |
| 0077 | Copy stays sourced from `guest-content.ts` (`GUEST_GLOSSARY`, `GUEST_FACT_LABELS`, `GUEST_DEMO_COPY`) | I4 / `stayCardInnerHtml`, `demoListingChipHtml` |
| 0078 | >=44px interactive targets (`.ui-stay-card__title`, `.ui-result-row`, `.ui-list__row`, `.ui-segmented > :is(a,label)`); 0 overflow at 320px | AC1, AC2, AC4 / `shortlet-foundations.css`, captures |
| 0102 | Chat cards project from `guest-kit.ts` `stayCardInnerHtml` and preserve `.stay-card`/`.stay-grid` hooks | AC3, I6 / `shortlet-renderers.ts`, `guest-kit.ts` |
| 0105 | Demo listing label stays legible on stay cards over media (`__label`) without altering gating | AC1 / `stayPhotoHtml`, `stayCardInnerHtml` |
| 0108 | Pinned round-12 design bundle authority; unshipped `Save`/`Saved` and `/plans` view-switch routes held back | AC3, I1, I4 / `shortlet-foundations.css`, `guest-kit.ts` |

## Tests

`npm run check`, `test/guest-retired-classes.test.ts`, discovery/search/gallery tests, and `capture-11-all.sh`. Record exact commands, counts, and capture findings in `## Comments`.

## Comments

- Ported `2b-04` component rules in [shortlet-foundations.css](../../../apps/web/src/shortlet-foundations.css) against pinned [round-12/bundle.css](../design/round-12/bundle.css): `.ui-stay-card*` (fixed `44px` `.ui-stay-card__title` min-height, `__media` 16:10 + preserved `__photo` 4:3/--radius-card check, `__label`, `__body`, `__facts`, `__total`), `.ui-result-rows`/`.ui-result-row*` (`--muted`, `--no-thumb`, `__next`, Newsreader `__price`), `.ui-list*` (`__row--static`, `__aside--money`, `[aria-busy="true"]`, chevronless column adjustment), and `.ui-segmented` (`.ui-segmented > a` and `> label`, `--radius-control`, `.payment-choice-methods` preserved). Placed `--mode-accent-subtle` fills on `.ui-stay-card__media, .ui-result-row__thumb` after `.ui-status {`.
- Updated `stayPhotoHtml` and `stayCardInnerHtml` in [guest-kit.ts](../../../apps/local-guest/src/guest-kit.ts) to wrap body content in `.ui-stay-card__body` and badge demo chips in `.ui-stay-card__label`; updated [shortlet-renderers.ts](../../../apps/local-guest/src/shortlet-renderers.ts) to append Compare links inside `.ui-stay-card__body`.
- Updated [test/guest-kit.test.ts](../../../test/guest-kit.test.ts) AC6 to assert `.ui-segmented` uses `var(--radius-control)`.
- **Held back for owner (Phase 3/5 / `copy-decisions.md`):**
  - Copy & features held back: no `Save` / `Saved` buttons added on stay cards, no Find view-switch links/routes added, `"1 / N"` photo count copy and shipped `GUEST_FACT_LABELS` preserved (`Photo 1 of 7` and `All-in · N nights` not introduced).
- **Verification:**
  - TDD Red run: `npx tsx --test test/round12-class-parity.test.ts test/round12-2b-04.test.ts` -> `2 pass, 3 fail` (AC1/AC3, AC2, and `2b-04` I3 failed prior to implementation).
  - `npm run build && npm run check && npx tsx --test test/round12-class-parity.test.ts test/guest-kit.test.ts test/guest-kit-targets.test.ts test/guest-retired-classes.test.ts test/guest-conventional-search.test.ts test/listing-gallery.test.ts test/demo-mode-guest.test.ts test/guest-payment-choice.test.ts test/demo-listing-chip.test.ts test/weaver-discovery-cards-catalogue.test.ts test/shortlet-token-parity.test.ts && npx tsx --test test/round12-2b-04.test.ts` -> **58 pass, 0 fail** + **2 pass, 0 fail** (**60/60 pass**).
  - Sequential 21-group `capture-11.ts` sweep (`320`, `390`, `768`, `1280`, light & dark) saved into `.scratch/guest-ui-consistency/screenshots/2b-04/`: **0 horizontal overflow**, **0 actionable controls under 44px** across all 21 groups (only expected 1x1 hidden radio `<input>`s on `payment-choice`).
  - Post-commit `npx tsx --test test/landing-page.test.ts` (see git log / final report).
