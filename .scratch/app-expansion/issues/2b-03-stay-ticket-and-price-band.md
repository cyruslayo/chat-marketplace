# Phase 2b-03: Port stay ticket and price band

Status: resolved
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

| ADR | Constraint imposed | Affected acceptance criterion / code path |
| --- | --- | --- |
| 0015 | All-In Stay Total leads price presentation before deposit and due/paid amount | AC1, I1 / `breakdownHtml`, `priceBreakdownHtml`, `.ui-price-breakdown*` |
| 0016 | Refundable Security Deposit shown on its own separate line, never added into Stay Total | AC2, I4 / `priceBreakdownHtml`, `GUEST_FACT_LABELS.refundableSecurityDeposit` |
| 0077 | Shared semantic tokens and dark/system contrast; `guest-content.ts` holds all copy | AC1, AC3, I2, I4 / `shortlet-foundations.css`, `guest-kit.ts` |
| 0078 | Newsreader 500 for `₦` figures with `lining-nums tabular-nums`; mobile >=44px/0 overflow | AC3, AC4 / `.ui-ticket__day`, `.ui-price-breakdown__value`, `.ui-steps__number`, captures |
| 0089 | Zero-deposit pilot rule: omit deposit row when `refundableSecurityDepositKobo <= 0` | AC2 / `priceBreakdownHtml` (`guest-kit.ts`) |
| 0092 | Extended Stay period breakdown and labels preserved unchanged | I1 / `priceBreakdownHtml` (`next`, `thisPayment`, `amountPaid`) |
| 0102 | Chat cards and standalone pages project from the same kit component structure | I6 / `ticketHtml`, `breakdownHtml`, `unitTilesHtml`, `stepsHtml` |
| 0108 | Pinned round-12 design bundle authority; unapproved issue-07 tokens & copy held back | AC1, I4 / `--radius-small` on `__condition`, shipped copy preserved |

## Tests

`npm run check`, `test/guest-retired-classes.test.ts`, ticket/breakdown/confirmation rendering tests, and `capture-11-all.sh`. Record exact commands, counts, and capture findings in `## Comments`.

## Comments

- Ported `2b-03` components in [shortlet-foundations.css](../../../apps/web/src/shortlet-foundations.css) against pinned [round-12/bundle.css](../design/round-12/bundle.css): `.ui-ticket*` (including `.ui-ticket__eyebrow` in `var(--color-accent-on-inverse)` and `.ui-ticket :focus-visible` sand focus ring), `.ui-price-breakdown*` (`--band`, hairline top-ruled `--due`/`--paid` with Newsreader `500` figures, `--condition` using `var(--radius-small)`), `.ui-tiles*`, and `.ui-steps*` (including `--compact` and Newsreader `500` `--color-accent-ink` numerals).
- Updated [guest-kit.ts](../../../apps/local-guest/src/guest-kit.ts) (`ticketHtml` emitting `.ui-ticket__eyebrow` while preserving `.ui-ticket__label` on Check-in/Check-out, `breakdownHtml` & `priceBreakdownHtml` supporting optional `band?: boolean` for `.ui-price-breakdown--band`, and `stepsHtml` supporting optional `{ compact?: boolean }`). Preserved zero-deposit omission (ADR 0089).
- Updated [test/guest-kit.test.ts](../../../test/guest-kit.test.ts) AC6 to assert `.ui-price-breakdown__condition` uses `var(--radius-small)` rather than `--radius-pill`.
- **Held back for owner (issue 07 / `copy-decisions.md`):**
  - Token not added: `--radius-badge` (`var(--radius-small)` kept on `.ui-price-breakdown__condition`).
  - Copy held back: all shipped `GUEST_FACT_LABELS` / `GUEST_GLOSSARY` strings kept (`"(separate)"`, `"All-In Stay Total"`, `"Your stay"`, `"View receipt"`); no unapproved `"Price for your dates"` / `", separate"` strings introduced.
- **Verification:**
  - TDD Red run: `npx tsx --test test/round12-class-parity.test.ts test/round12-2b-03.test.ts` -> `4 pass, 2 fail` (AC1/I2/I3 and class-parity failed prior to implementation).
  - `npm run build && npm run check && npx tsx --test test/round12-class-parity.test.ts test/guest-kit.test.ts test/guest-kit-targets.test.ts test/guest-retired-classes.test.ts test/shortlet-design-system.test.ts test/shortlet-token-parity.test.ts test/guest-request-consistency.test.ts test/guest-offer-payment-clarity.test.ts test/guest-payment-consistency.test.ts test/guest-unit-detail-consistency.test.ts && npx tsx --test test/round12-2b-03.test.ts` -> **46 pass, 0 fail** + **3 pass, 0 fail** (**49/49 pass**).
  - Sequential 21-group `capture-11.ts` sweep (`320`, `390`, `768`, `1280`, light & dark) saved into `.scratch/guest-ui-consistency/screenshots/2b-03/`: **0 horizontal overflow**, **0 actionable controls under 44px** across all 21 groups (only expected 1x1 hidden radio `<input>`s on `payment-choice`).
  - Post-commit `npx tsx --test test/landing-page.test.ts` (see git log / final report).
