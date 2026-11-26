# Phase 2b-01: Port buttons, links, fields, banners and status

Status: resolved
Type: task
Blocked by: 07

## Why

Port the atomic controls and status primitives in `apps/web/src/shortlet-foundations.css` and `apps/local-guest/src/guest-kit.ts` to the pinned round-12 [bundle.css](../design/round-12/bundle.css) before higher-level layout and chat groups build on them.

## What to build

- Port `.ui-button*` (`.ui-button`, `--primary`, `--secondary`, `--quiet`, `--pill`, `--small`, `--block`, `[aria-busy]`, `[disabled]`), `.ui-link`, `.ui-field*` (including `.ui-choice`, `.ui-legend`), `.ui-banner*` (`.ui-banner--info`, `__title`, `__body`, `__actions`), `.ui-status*` (`.ui-status--muted` alongside existing status tones), `.ui-tag*`, `.ui-deadline*`, `.ui-facts*`, `.ui-empty*`, and `.ui-skeleton*` using [class-map.md](../design/round-12/class-map.md).
- Keep the committed formatting of `shortlet-foundations.css` (do not run a formatter; foundation regex tests depend on it).
- Keep existing code-only classes (`ui-button--destructive`, `ui-sr-only`, `ui-eyebrow`, `ui-upload`, `ui-status--neutral`, `ui-status--stale`, etc.) unless a board explicitly replaces them.
- Serial files: `apps/web/src/shortlet-foundations.css`, `apps/local-guest/src/guest-kit.ts`.

## Acceptance criteria

- AC1: Every mapped class in this group matches the pinned [bundle.css](../design/round-12/bundle.css) rules using semantic tokens only (no raw hex, no `xk-*`/`bd-*`).
- AC2: All interactive controls (`.ui-button`, `.ui-link`, `.ui-choice`, `.ui-field__input`) meet >=44px targets and focus-visible contrast in light and dark themes.
- AC3: No existing copy or behaviour changes; any `Code` string rendered in this group stays sourced from `guest-content.ts` (no unapproved `New`/`Brand` copy).
- AC4: Captures at 320/390/768/1280 light and dark under `screenshots/2b-01/` and `capture-11-all.sh` pass with zero horizontal overflow and zero targets <44px.

## Integrity checks (`kickoff.md` §4)

- **I1 (Fact map):** No new facts or actions added; existing deadline/status fields trace to `fact-map.md`.
- **I2 (Token parity):** Uses only semantic tokens mapped in issue 07; zero hex outside the token block.
- **I3 (Class parity):** Every class matches `class-map.md`; retired classes (`.waiting-panel`, `.stay-result`, `GUEST_STAY_PAYMENT_STYLE`) remain absent; zero `xk-*`/`bd-*` classes in `apps/`.
- **I4 (Copy provenance):** No `New` or `Brand` strings from `copy-decisions.md` introduced without owner approval.
- **I6 (Chat and page agree):** Shared helpers in `guest-kit.ts` continue to render identical status, deadline, and banner markup for chat and pages.
- **I8 (Captures):** 320/390/768/1280 light & dark captures + `capture-11-all.sh` pass.
- **I10 (Scope):** Stays only; commerce stays off.

## ADR compliance

| ADR | Constraint imposed | Affected acceptance criterion / code path |
| --- | --- | --- |
| 0075 | No secrets or raw internal tokens leaked in UI or error states | AC1 / `.ui-banner*`, `.ui-field__error` preserve sanitised surfaces |
| 0077 | Shared `shortlet-foundations.css` semantic palette with dark/system modes and AA contrast | AC1, AC2 / `apps/web/src/shortlet-foundations.css`, `test/shortlet-ui-foundations.test.ts` |
| 0078 | Low-end Android mobile-first baseline (>=44px targets, readable type, no overflow) | AC2, AC4 / `.ui-button*`, `.ui-link`, `.ui-choice`, `.ui-field__input` (`>=44px`), captures |
| 0080 | Shared guest UI kit rendered consistently across chat and pages without client/server drift | AC3, I6 / `apps/local-guest/src/guest-kit.ts`, `test/guest-kit.test.ts` |
| 0107 | Surface-driven mode isolation; `--mode-*` never drives buttons, status, banners, or money | AC1, I2 / `test/round12-class-parity.test.ts` |
| 0108 | Pinned round-12 design bundle authority; hold back unapproved issue-07 tokens and unapproved copy | AC1, AC3, I4 / `apps/web/src/shortlet-foundations.css`, `guest-kit.ts` |

## Tests

`npm run check`, `test/guest-retired-classes.test.ts`, foundation CSS/token tests, and `capture-11-all.sh` (one group at a time). Record exact commands, counts, and capture findings in `## Comments`.

## Comments

- Ported `2b-01` component rules in [shortlet-foundations.css](../../../apps/web/src/shortlet-foundations.css) against pinned [round-12/bundle.css](../design/round-12/bundle.css) and [class-map.md](../design/round-12/class-map.md): `.ui-visually-hidden` alias beside `.ui-sr-only`, `.ui-button*` (`--primary`, `--secondary`, `--quiet`, `--pill`, `--small`, `--block`, `--destructive`, `:disabled`/`[aria-disabled="true"]`, `[data-loading]`/`[aria-busy="true"]`), `.ui-link` (44px inline-flex target, underline), `.ui-field*` (`.ui-field__input`, `--error`/`:invalid` warning highlight, `.ui-field__optional`, `.ui-choice`, `.ui-legend`), `.ui-status*` (including `--muted`), `.ui-tag*` (`--overdue`), `.ui-deadline*`, `.ui-banner*` (`--neutral`, `--info`, `--success`, `--warning`, `--danger`, `__title`, `__body`, `__actions`), `.ui-empty*`, and static `.ui-skeleton*` (removed `@keyframes ui-pulse`).
- **Held back for owner (issue 07 / `copy-decisions.md`):**
  - Tokens not added: `--color-scrim`, `--font-weight-label-small` / `--text-small-strong` (`font-weight: 600` used literally where needed), `--radius-badge` (`var(--radius-small)` retained on `.ui-tag` / `.ui-price-breakdown__condition`), and `--font-size-label` 16px bump (`0.9375rem` kept).
  - Copy held back: all shipped `Code` copy kept (`guest-content.ts` & `guest-kit.ts`); no `New` or `Brand` strings introduced.
- **Verification:**
  - TDD Red run: `Remove-Item Env:LLM_API_KEY -ErrorAction SilentlyContinue; npx tsx --test test/round12-class-parity.test.ts test/round12-2b-01.test.ts` -> `3 pass, 3 fail` (AC1, AC2, I3 `2b-01` failed before CSS updates).
  - `npm run build && npm run check && npx tsx --test test/round12-class-parity.test.ts test/round12-2b-01.test.ts test/shortlet-token-parity.test.ts test/shortlet-ui-foundations.test.ts test/shortlet-design-system.test.ts test/guest-kit.test.ts test/guest-kit-targets.test.ts test/guest-retired-classes.test.ts test/self-hosted-type.test.ts` -> **41 pass, 0 fail, 1 skipped** (the `SHORTLET_FOUNDATIONS_BROWSER=1` gated subtest in `test/shortlet-ui-foundations.test.ts`).
  - Sequential 21-group `capture-11.ts` sweep (`320`, `390`, `768`, `1280`, light & dark) saved into `.scratch/guest-ui-consistency/screenshots/2b-01/`: **0 horizontal overflow**, **0 actionable controls under 44px** across all 21 groups (only expected 1x1 hidden radio `<input>`s inside 44px labels on `payment-choice`).
  - Post-commit `npx tsx --test test/landing-page.test.ts` (see git log / final report).
