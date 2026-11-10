# 15 · Skip links on standard pages

Status: resolved
Type: task
Blocked by: none
Phase: 2 (Batch B)
Applicable ADRs: 0078, 0080

## What to build

`pageShell` and `errorPage` (`apps/web/src/ui-kit.ts:114,130`) render no skip link. The chat shell has "Skip to conversation".

- Add a "Skip to main content" link targeting `<main id>` in `pageShell`, reusing the landing `.landing-skip` pattern (44px, visible on focus) as a kit class in the existing kit block.

## Acceptance criteria

1. Every standard guest page has a skip link as its first focusable element
2. The skip link moves focus to the main region
3. The skip link is at least 44 by 44 CSS px when focused

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
| 0078 | Keyboard operation, focus, 44x44 practical targets, 320px reflow. | AC2 and AC3. |
| 0080 | Standard routes carry the same task facts and recovery. | The skip link is part of every standard route, not only the landing page. |

### Implementation

`pageShell` now emits `<a class="ui-skip-link" href="#main-content">Skip to main content</a>` as the first body element, before the optional app frame, and `<main id="main-content" tabindex="-1">` so the fragment link moves focus. `errorPage` uses the same shell, so error pages get the link too. The kit rule `.ui-skip-link` in `shortlet-foundations.css` reuses the landing pattern with semantic tokens (`--control-min-target`, `--layer-skip-link`) and is visible on `:focus`.

### Tests and commands

- `npm run check` — 0 errors.
- `npx tsx --test test/guest-skip-link.test.ts` — 2 tests, 2 passed, 0 failed.
- Real Chrome: `npx tsx --test test/guest-skip-link-chromium.test.ts` — 1 test, 1 passed, 0 failed (first Tab, 44x44, Enter focuses main).
- After committing the CSS: `npx tsx --test test/landing-page.test.ts` — 33 tests, 33 passed, 0 failed.
- Captures: `npx tsx .scratch/ux-guidelines/capture-15.ts` — 8 captures at 320/390/768/1280 in light and dark under `.scratch/ux-guidelines/screenshots/15/`; findings show no horizontal overflow and no visible control under 44px.

## Answer

Every standard guest page and error page now starts with a "Skip to main content" link that is the first focusable element, is at least 44x44 when focused, and moves focus to `<main id="main-content">`.
