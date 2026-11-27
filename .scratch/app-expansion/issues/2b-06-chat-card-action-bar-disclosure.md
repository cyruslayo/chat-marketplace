# Phase 2b-06: Port chat card, action bar, disclosure and commit panels

Status: resolved
Type: task
Blocked by: 07, 02, 2b-01

## Why

Port the summary and decision-commit containers — `.ui-chat-card*`, `.ui-action-bar*` (including `--sticky`), `.ui-confirm*` / `.ui-effect*`, and `.ui-panel*` (`--commit`, `__title`) — to the pinned round-12 [bundle.css](../design/round-12/bundle.css), aligned with issue 02's component library decision.

## What to build

- Port `.ui-chat-card` (`__head`, `__title`, `__aside`, `__rows`, `__row`), `.ui-action-bar` (`__sum`, `--sticky`), `.ui-confirm` (`__body`, `.ui-effect`, `__title`, `__body`), and `.ui-panel` (`--commit`, `__title`) in `apps/web/src/shortlet-foundations.css` and `apps/local-guest/src/guest-kit.ts` / typed catalogue renderers per issue 02.
- Ensure sticky `.ui-action-bar--sticky` sits inline inside `@container (min-width:48rem)` and does not obscure focus or overflow at 320px.
- Serial files: `apps/web/src/shortlet-foundations.css`, `apps/local-guest/src/guest-kit.ts`, `apps/local-guest/src/client.ts`, `apps/local-guest/src/shortlet-app.ts`.

## Acceptance criteria

- AC1: `.ui-chat-card__row` links, `.ui-confirm > summary` disclosures, and `.ui-action-bar` buttons all meet >=44px targets with clear focus-visible outlines at 320–1280 in light and dark themes.
- AC2: Offer, payment choice, request review, and booking confirmation screens share identical markup between chat cards/surfaces and standalone pages.
- AC3: Assistant-enabled cold-restore journey (`ADR 0106`) passes without stale surface or action mismatches.
- AC4: Captures at 320/390/768/1280 light and dark under `screenshots/2b-06/` and `capture-11-all.sh` pass with zero overflow and zero targets <44px.

## Integrity checks (`kickoff.md` §4)

- **I1 (Fact map):** Offer/payment/request card rows and action bar totals trace to `OfferScreenContent`, `PaymentScreenContent`, and `RequestScreenContent` in `fact-map.md`.
- **I2 (Token parity):** Semantic tokens only; zero hex outside the token block.
- **I3 (Class parity):** Matches `class-map.md`; zero `xk-*`/`bd-*` classes in `apps/`.
- **I4 (Copy provenance):** Existing `guest-content.ts` strings only (keep `Continue to stay payment · ₦…` unless `Continue to secure payment` is approved in `copy-decisions.md`).
- **I5 (Rules gate):** No unbuilt Cancel/Change/Report actions exposed inside disclosures or chat cards.
- **I6 (Chat and page agree):** Same `guest-kit.ts` helpers power both chat cards and standalone pages.
- **I7 (Cold restore):** Tested with assistant enabled and cold restore before every event (`ADR 0106`).
- **I8 (Captures):** 320/390/768/1280 light & dark + `capture-11-all.sh` pass.
- **I10 (Scope):** Stays only; commerce stays off.

## ADR compliance

0005, 0044, 0072, 0074, 0077, 0078, 0080, 0102, 0106, 0108.

## Tests

`npm run check`, `test/assistant-cold-journey.test.ts`, `test/guest-retired-classes.test.ts`, offer/payment screen tests, and `capture-11-all.sh`. Record exact commands, counts, and capture findings in `## Comments`.

## Comments

- 27 Nov 2026 (resolved on `feat/app-expansion-2b-06`, from `feat/app-expansion-2b-05`): Ported `.ui-chat-card*` (44px `__row` links, `:focus-visible`, hover underline), `.ui-action-bar--sticky` (inline base, sticky only as `--sticky`, >=48rem container sits it inline), quiet `.ui-confirm` (3.25rem summary), `.ui-panel--commit`/`__title` and pinned `.ui-effect` anatomy (icon + `p.__title` + `p.__body`) in `shortlet-foundations.css`; added `chatCardHtml`/`chatCardText` to `guest-kit.ts` (JSON-serialisable props, escaped, no domain copy, `chatCardText` fallback; ADR 0074/0075/0077, Tier 3 on `shortlet-booking/v1`); shared `renderUnitActionBar` markup in `shortlet-renderers.ts` serves chat and page organizers unchanged. No A2UI or catalogue change (note 1); `Continue to stay payment` kept (I4).
  - Red first: `npx tsx --test test/round12-2b-06.test.ts test/round12-class-parity.test.ts` = 2 pass, 2 fail. Green: same pair = 10 pass, 0 fail.
  - `npm run check` = clean. (Global `NODE_ENV=production` on this machine: every command needs `set NODE_ENV=test&&` or fixture boot throws `PAYSTACK_SECRET_KEY is required`.)
  - Node batch (21 files, incl. `test/assistant-cold-journey.test.ts`, `test/guest-retired-classes.test.ts`, `test/self-hosted-type.test.ts`, offer/payment/request/confirmation consistency, `test/pilot-commerce-off.test.ts`) = 105 pass, 0 fail.
  - Real Chrome one at a time after `npm run build` (rebuilt `apps/local-guest/dist/client.js`, committed): `guest-app-frame-chromium` 2 pass, `guest-offer-consistency-chromium` 5 pass (1 fail before the rebuild on the stale bundle), `guest-payment-consistency-chromium` 3, `guest-offer-payment-clarity-chromium` 1, `guest-request-repair-chromium` 3, `guest-confirmation-system-chromium` 3, `shortlet-ui-foundations` 2 — all 0 fail.
  - Captures: `capture-2b06.ts` (committed) — request-review, offer-live, payment-choice and a synthetic chat-card + confirm screen, chat and page, 320/390/768/1280 light+dark into `screenshots/2b-06/` (72 shots): 0 overflow, no target <44px (hidden payment radios are 1x1; their labels are the targets). Fix during captures: the synthetic `.ui-effect` fixture lacked the icon owning grid column 1 so the title broke into the 20px column; both `capture-2b06.ts` and `test/round12-2b-06.test.ts` now use the shipped anatomy (icon + `p` + `p`, as `local-owner-server.ts` renders) and lay out correctly (vision-checked).
  - 21-group `capture-11` sweep re-run: every findings file clean except `findings-payment-choice.txt`, byte-identical to the committed baseline (known 1x1 hidden radios). Zero new findings.
  - Held back: no live `chatCardHtml` emitter (Phase 3/4, note 3); no "Current" tag; `guest-server.ts` untouched, so the no-JS unit-detail page keeps its own sticky rule and `.ui-page` (max 47.5rem) keeps the standalone bars sticky as shipped.
- 26 Nov 2026 (issue 02 reconciliation, see [notes/02-surface-kit.md](../notes/02-surface-kit.md)):
  - **What `2b-06` must do differently:**
    1. **Zero A2UI schema or catalogue ID changes:** Do **not** mint a new catalogue ID (`ADR 0073`) and do **not** add a `ChatCard` A2UI component to `apps/web-agent/src/shortlet-catalogs.ts` in `2b-06`. Port `.ui-action-bar--sticky` purely via `shortlet-foundations.css`, `guest-kit.ts`, `renderUnitActionBar` (`shortlet-renderers.ts`), and the 4 booking screen organizers in `client.ts` (`UnitActionBar`'s schema props stay unchanged).
    2. **Author `chatCardHtml` ADR-0108-ready:** Any new `chatCardHtml(props)` helper added to `apps/local-guest/src/guest-kit.ts` for `.ui-chat-card*` must accept strict JSON-serialisable props, hold no hardcoded domain copy (labels passed from `guest-content.ts`, `ADR 0077`), escape every value (`ADR 0075`), and pair with a complete plain-text fallback helper `chatCardText(props)` (`ADR 0074`).
    3. **Tier correction for `ChatCard`:** `design/round-12/design-system/components/ChatCard/README.md` cites "Your stays" + "period payment" as two uses for Tier 2, but both are inside Stays. Under `ADR 0108` decision 2, `ChatCard` will land as **Tier 3** (additive on `shortlet-booking/v1`) when Phase 3/4 emits those chat cards, promoting to Tier 2 only when a second real domain uses it (or Tier 1 only if platform-owned for `/plans` with zero domain vocabulary).
    4. **Keep `Confirm` / `Panel` as kit helpers:** `.ui-confirm` / `.ui-effect` and `.ui-panel--commit` stay kit helpers + booking organizer DOM until Phase 3 retires the 4 remaining organizers (`organizeRequestScreen`, `organizeOfferScreen`, `organizePaymentScreen`, `organizeConfirmation`).
    5. `2b-06` does **not** need to wait for Follow-ups A–C (surface-kit code landing) because it makes zero A2UI catalogue changes; only `07` and `2b-01` block it.
