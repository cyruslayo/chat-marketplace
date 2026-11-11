# 17 · Targets, small text and state styling hooks

Status: resolved
Type: task
Blocked by: none
Phase: 2 (Batch B)
Applicable ADRs: 0078 (44px targets, readable text); guideline §7

## What to build

In `apps/web/src/shortlet-foundations.css`:

- `.ui-button--small` and `.ui-stay-card__count` are 2.25rem (36px). Give their hit area 44px (the visual size may stay smaller if `min-block-size` or padding gives a 44px target).
- `.ui-rail` labels are 0.6875rem (11px). Raise them to the 12px minimum for secondary metadata (§7). Check the rail at 390 for mid-word breaks (see landing issue 03).
- Add `[aria-busy="true"]` styling alongside `[data-loading="true"]`, `text-wrap: pretty` on body `p` and `dd`, and `accent-color: var(--color-action)` for native radios and checkboxes.

## Acceptance criteria

1. No visible guest control is under 44 by 44 CSS px at any capture width
2. No guest text is under 12px
3. A busy control styled only with aria-busy shows the busy state
4. The foundation CSS tests pass on the committed file

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- Foundation CSS: keep the committed formatting and literal six-digit hex tokens (`guest-kit.test.ts`, `shortlet-design-system.test.ts`). Commit `shortlet-foundations.css` edits before running `test/landing-page.test.ts`, because it fails on any uncommitted change to that file.
- Guest UI: finish with captures at 320, 390, 768 and 1280 (light and dark) under `.scratch/ux-guidelines/screenshots/<NN>/`, and a findings file showing no horizontal overflow and no control under 44px (ADR 0078).

## Comments

### ADRs read and applied

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0078 | 44x44 practical targets, readable text, 320px reflow, reduced motion. | AC1, AC2, AC3. |
| 0077 | Status always has words, not colour alone. | The busy state keeps its label and adds the spinner. |
| 0081 | Weaver output is styled by the kit, not by page-specific CSS. | All changes are in the existing Guest UI kit block. |

### Implementation

- `.ui-button--small` and `.ui-stay-card__count` now use `min-block-size`/`min-inline-size: var(--control-min-target)` (44px).
- `.ui-rail > li` is 12px with `overflow-wrap: normal`, `word-break: normal` and `hyphens: none`; a browser probe at 390 shows six 56px columns, 12px labels, no overflow and no mid-word break.
- Every `.ui-button[data-loading="true"]` busy rule also matches `[aria-busy="true"]`, including the spinner and `cursor: progress`.
- `:where(p, dd) { text-wrap: pretty; }` and `:where(input[type="radio"], input[type="checkbox"]) { accent-color: var(--color-action); }` are added to the base layer.

### Tests and commands

- `npm run check` — 0 errors.
- `npx tsx --test test/guest-kit-targets.test.ts` — 3 tests, 3 passed, 0 failed.
- After committing the CSS: `npx tsx --test test/landing-page.test.ts test/guest-kit.test.ts test/shortlet-design-system.test.ts` — 51 tests, 51 passed, 0 failed.
- Captures: `npx tsx .scratch/ux-guidelines/capture-17.ts` — 16 captures at 320/390/768/1280 in light and dark under `.scratch/ux-guidelines/screenshots/17/`; findings show no horizontal overflow, no visible control under 44px and no text under 12px (hidden 1x1 native radios excluded; their labels are the targets).

## Answer

Guest controls meet 44x44, guest text is at least 12px, the rail no longer breaks words at 390, `aria-busy` alone shows the busy state, prose uses `text-wrap: pretty`, and native choice controls use the action accent colour.
