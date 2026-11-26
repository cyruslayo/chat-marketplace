# Phase 2b-03: Port stay ticket and price band

Status: ready-for-agent
Type: task
Blocked by: 07, 2b-01

## Why

Port the inverse stay ticket (`.ui-ticket*`), price breakdown / ticket price band (`.ui-price-breakdown*`, `.ui-price-breakdown--band`), stay fact tiles (`.ui-tiles*`), and numbered next-steps list (`.ui-steps*`) to the pinned round-12 [bundle.css](../design/round-12/bundle.css) and [guest-kit.ts](../../../../apps/local-guest/src/guest-kit.ts).

## What to build

- Port `.ui-ticket`, `.ui-ticket__eyebrow` (keep/alias `.ui-ticket__label` where shared), `.ui-ticket__name`, `__dates`, `__date`, `__date--end`, `__day`, `__time`, `__arrow`, `__foot`, `.ui-price-breakdown*` (including `--band`), `.ui-tiles*`, and `.ui-steps*` (including `--compact`).
- Preserve the pilot zero-deposit rule (`ADR 0089`, `D32`): `priceBreakdownHtml` omits the deposit line when `refundableSecurityDepositKobo <= 0` — **do not** copy the boards' illustrative ₦50,000 deposit line.
- Keep `₦` figures set in `Newsreader 500` (`--font-display`) with `lining-nums tabular-nums` as specified in `bundle.css`.
- Serial files: `apps/web/src/shortlet-foundations.css`, `apps/local-guest/src/guest-kit.ts`.

## Acceptance criteria

- AC1: Ticket, price breakdown / band, tiles, and steps match [bundle.css](../design/round-12/bundle.css) across 320/390/768/1280 in light and dark themes.
- AC2: Zero-deposit pilot quotes never display a synthetic deposit line; non-zero quotes still display deposit on its own separate line (`ADR 0016`, `ADR 0089`).
- AC3: Every `₦` figure renders in `--font-display` (Newsreader 500) and ticket focus outlines use `var(--color-accent-on-inverse)` (`sand`).
- AC4: Captures at 320/390/768/1280 light and dark under `screenshots/2b-03/` and `capture-11-all.sh` pass with zero overflow and zero targets <44px.

## Integrity checks (`kickoff.md` §4)

- **I1 (Fact map):** Ticket dates, nights, guests, booking reference, and price breakdown rows trace to `StayTicketFacts`, `PriceBreakdownInput`, and `BookingContractArtifact`/`OfferScreenContent`/`RequestScreenContent` in `fact-map.md`.
- **I2 (Token parity):** Semantic tokens only (inverse surface + `sand` accent on inverse); zero hex outside the token block.
- **I3 (Class parity):** Matches `class-map.md`; zero `xk-*`/`bd-*` classes in `apps/`.
- **I4 (Copy provenance):** All labels (`GUEST_FACT_LABELS`, `GUEST_GLOSSARY`) come from `guest-content.ts`; keep `"(separate)"` unless `", separate"` is approved in `copy-decisions.md`.
- **I6 (Chat and page agree):** `stayTicketHtml`, `priceBreakdownHtml`, `unitTilesHtml`, and `stepsHtml` in `guest-kit.ts` remain the single markup source for chat and standalone pages.
- **I8 (Captures):** 320/390/768/1280 light & dark + `capture-11-all.sh` pass.
- **I10 (Scope):** Stays only; no price/deadline/refund changes.

## ADR compliance

0015, 0016, 0077, 0078, 0089, 0092, 0102, 0108.

## Tests

`npm run check`, `test/guest-retired-classes.test.ts`, ticket/breakdown/confirmation rendering tests, and `capture-11-all.sh`. Record exact commands, counts, and capture findings in `## Comments`.

## Comments
