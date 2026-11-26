# Xenia tokens in the code's own token names

Status: resolved
Type: task
Blocked by: none. Serial with any other change to `shortlet-foundations.css`

## Why

The kit and the code disagree on colour. The owner confirmed Adire Indigo on 20 Nov 2026, and the brand's open decision 1 asks for this issue.

## What to build

- Keep the code's semantic names and change their values, light and dark. Use kit audit §5 (`docs/design/xenia-ui-kit-parity-audit.md` on `docs/ux-guidelines` until issue 01 lands) and the design system's `tokens.json` (<https://claude.ai/artifact/XH7yVkfLzKG357Gxqc1F3d>).
- Mode tokens: keep `main`'s `--mode-accent`, `--mode-accent-subtle`, `--mode-on-accent` and `--mode-tint`. Stays takes clay. The kit's `--mode-subtle` maps to `--mode-accent-subtle`. Today the stays block uses the action colour; after this it must not.
- Derive the `--color-*-border` and `--color-info*` values the brand does not define, and record how.
- Update the theme colour that follows the mode tint (agent-modes 03k), and the landing tokens.
- Keep the committed CSS formatting. Change no component rule.

## Acceptance criteria

- AC1: Every mapped token has the brand value in both themes. A test reads one mapping, not copies of the hex.
- AC2: Text and control contrast meets WCAG 2.2 AA for every pair the foundation tests cover, in both themes.
- AC3: The action colour is never a mode accent, and a mode accent is never used for an action, money or status.
- AC4: `capture-11-all.sh` passes: no overflow, no control under 44px. Captures are saved under `screenshots/07/`.
- AC5: No class, markup or copy changes; the diff is tokens, tests and captures.

## ADR compliance

0078, 0107 decision 4. AGENTS.md: semantic tokens only.

## Tests

The files that read `shortlet-foundations.css` (25 at d1d5955), then `npm run check`.

## Comments

### ADR compliance

| ADR | Constraint | Affected AC / Code Path |
| --- | --- | --- |
| **ADR 0078** | WCAG 2.2 AA contrast (>= 4.5:1 text, >= 3:1 UI/focus), 44x44px targets, 320px reflow without horizontal overflow, no third-party font requests (`@import url`). | AC2, AC4; `apps/web/src/shortlet-foundations.css`, `apps/web/src/shortlet-landing.css`, `test/shortlet-token-parity.test.ts`, `capture-11-all.sh` |
| **ADR 0102** | Shortlet discovery and booking catalogues render through platform-owned guest-kit helpers using semantic tokens; no markup/schema/behaviour changes in this issue. | AC5; `apps/web/src/shortlet-foundations.css` (tokens only, no component rules or catalogue changes) |
| **ADR 0107** (decisions 4, 10) | Colours never travel in `ModePresentation`; each registered mode has a `--mode-*` block scoped by `:root[data-mode="<id>"]` in `shortlet-foundations.css` (light, dark, system-dark) meeting WCAG 2.2 AA; unregistered/parked domains (`events`, `community`, `services`) get no mode block; first-paint theme-color metas match stays `--mode-tint`. | AC1, AC2, AC3; `:root[data-mode="stays"]` in `apps/web/src/shortlet-foundations.css`, `apps/local-guest/src/shell-theme-colour.ts`, `test/agent-mode-follows-task.test.ts`, `test/agent-mode-theme-color.test.ts` |
| **ADR 0108** | Shared component library / Surface Components consume semantic foundation tokens; this issue changes tokens only and introduces no component classes, props, or copy. | AC5; `apps/web/src/shortlet-foundations.css` (no component rules altered) |

### Pinned source & mapping notes

- **Source:** `.scratch/app-expansion/design/round-12/xenia-kit.css` (light `:root,[data-theme="light"]` and dark `[data-theme="dark"]` blocks) cross-checked against `.scratch/app-expansion/design/round-12/tokens.css` (pinned on `feat/app-expansion` at `92c115a`, since raw `tokens.json` was not included in the HTML bundle exports).
- **Mapped tokens:** All 26 Stays/core Xenia colour tokens mapped onto Shortlet's semantic names in `:root`, `:root[data-theme="dark"]`, and `@media (prefers-color-scheme: dark) { :root[data-theme="system"] }`, adding `--color-accent-ink` (`sand-ink`: `#815B1F` light, `#EBCC99` dark) per parity audit §5. Unregistered domain tokens (`--events-*`, `--community-*`, `--services-*`) remain omitted per ADR 0107 decision 10 and kickoff I10.
- **Mode accents:** `:root[data-mode="stays"]` now maps `--mode-accent: var(--color-accent)` (clay `#934319` / `#EDA382`), `--mode-accent-subtle: var(--color-accent-subtle)` (`#FEE5DB` / `#372016`), `--mode-on-accent: var(--color-on-action)` (`#FFFFFF` / `#0A1023`), `--mode-tint: var(--color-accent-subtle)`. `apps/local-guest/src/shell-theme-colour.ts` updated to `light: "#FEE5DB"`, `dark: "#372016"`.
- **Landing tokens:** `apps/web/src/shortlet-landing.css` `landing-brand-tokens` block updated to Adire Indigo (`#283F92` / `#111E47`), Warm Stone (`#F8F5EF`), and Sand (`#EBCC99` / `#815B1F`) in light, dark, and system-dark.
- **Primitive ramp & shadows:** Updated `:root` primitive ramp (`--indigo-*`, `--sand-*`, `--clay-*`) and light `--elevation-*` shadows from green-ink `rgb(29 41 35 / ...)` to Xenia ink `rgb(24 30 44 / ...)`.

### Derived tokens (not defined in Xenia `xenia-kit.css`)

- `--color-surface-elevated`: Light `#FFFFFF` (matches `--color-surface`); Dark `#242A38` (one step lighter than dark `--color-surface-subtle` `#1D212C` along the indigo-slate neutral axis).
- `--color-surface-viewer` / `--color-text-on-viewer`: Light `#0C0F17` (dark canvas) / `#EFEBE2` (dark ink); Dark `#0A1023` (dark `on-indigo`) / `#EFEBE2`.
- `--color-border-inverse` / `--color-text-on-inverse-muted`: Light `#283F92` (brand indigo) / `#D2D8E8` (11.32:1 on `#111E47`); Dark `#3A529E` / `#C6CFE6` (10.05:1 on `#162146`).
- `--color-info` / `--color-info-surface`: Light `#1E5B7A` / `#E6F1F8` (6.46:1, slate-blue distinct from Adire Indigo `#283F92` and success `#106C3E`); Dark `#7EC4E8` / `#102636` (8.09:1).
- `--color-*-border`: Derived via linear sRGB blend of `35%` status foreground + `65%` status surface in each theme:
  - `--color-success-border`: `#95C6AA` (light), `#336345` (dark)
  - `--color-warning-border`: `#D5B88B` (light), `#735728` (dark)
  - `--color-danger-border`: `#DDA5A4` (light), `#784440` (dark)
  - `--color-info-border`: `#A0BDCC` (light), `#365D74` (dark)

### Proposed names for Handover "Token needed" items (NOT added — awaiting owner approval)

1. **Dialog / photo viewer scrim:** Propose `--color-scrim` (e.g. `rgb(17 30 71 / 60%)` from `indigo-deep` at 60% opacity on `::backdrop`; photo viewer surface keeps `--color-surface-viewer`).
2. **14/20 600 small strong text style:** Propose `--font-weight-label-small: 600` (composed with `--font-size-small` / `--font-line-small`), or a composite `--text-small-strong` when typography tokens are ported in issue 09 / 2b.
3. **Badge or count radius:** Propose `--radius-badge` (aliasing `--radius-small` / `4px` to separate count badges/tags from `--radius-pill`).
4. **15/20 600 action label:** Recommend aligning `--font-size-label` from `0.9375rem` (15px) to `1rem` (16px) with `--font-line-label: 1.25` (20px) to match Xenia `--text-label: 600 16px/20px` rather than adding a 15px token.

### Verification, contrast & captures

- **TDD red run:** `npx tsx --test test/shortlet-token-parity.test.ts` failed 3 of 4 tests (1 pass: no stray hexes) against the retired green palette before token updates.
- **Type check & bundle guard:** `npm run check` passed cleanly (0 errors).
- **Affected non-browser tests:**
  - Batch run (`test/shortlet-token-parity.test.ts`, `test/shortlet-ui-foundations.test.ts`, `test/shortlet-design-system.test.ts`, `test/guest-kit.test.ts`, `test/guest-retired-classes.test.ts`, `test/agent-mode-follows-task.test.ts`, `test/agent-mode-theme-color.test.ts`, `test/agent-mode-shell.test.ts`, `test/agent-mark-shell.test.ts`, `test/back-office-home.test.ts`, `test/guest-kit-targets.test.ts`, `test/asset-loader.test.ts`, `test/cloudflare-static-assets.test.ts`, `test/guest-skip-link.test.ts`, `test/listing-gallery.test.ts`, `test/manual-transfer-with-receipt.test.ts`, `test/guest-payment-choice.test.ts`, `test/guest-contact-pilot.test.ts`, `test/guest-conventional-search.test.ts`, `test/guest-shell.test.ts`, `test/mode-suggestion-tier-c.test.ts`, `test/pilot-request-handler.test.ts`, `test/agent-mode-view-transition.test.ts`): 158/160 passed before fixing a regex match in a `:root` comment; after fixing the comment, re-ran `npm run check && npx tsx --test test/shortlet-token-parity.test.ts test/shortlet-ui-foundations.test.ts test/guest-kit.test.ts test/shortlet-design-system.test.ts`: **24/24 passed** (1 browser subtest skipped without `SHORTLET_FOUNDATIONS_BROWSER=1`).
- **Real Chrome theme-color test:** `npx tsx --test test/agent-mode-theme-color-chromium.test.ts` -> **2/2 passed**.
- **WCAG 2.2 AA contrast:** All mapped and derived pairs in `test/shortlet-token-parity.test.ts`, `test/shortlet-ui-foundations.test.ts`, `test/shortlet-design-system.test.ts`, `test/guest-kit.test.ts`, and `test/landing-page.test.ts` pass (>= 4.5:1 text, >= 3:1 borders/focus/large text) in light, forced-dark, and system-dark.
- **Captures (`capture-11-all.sh`, 21 screen groups at 320, 390, 768, 1280 light & dark, copied to `.scratch/guest-ui-consistency/screenshots/07/`):**
  - **Horizontal overflow:** 0 across all frames.
  - **Controls under 44px:** 0 actionable controls; `payment-choice` (`page` & `chat`, 16 frames) reports `INPUT 1x1 | INPUT 1x1 | INPUT 1x1` for the hidden native `<input type="radio">` elements inside `.ui-segmented > label` (44px labels, expected per `AGENTS.md`).
- **Post-commit landing gate:** `npx tsx --test test/landing-page.test.ts` and `npm run check` verified on the clean committed tree (confirming AC8 `git diff` check and Issue 07 AC4 landing contrast checks).
