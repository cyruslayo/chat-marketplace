# 24 · Rendering cost of long conversations

Status: resolved
Type: task
Blocked by: none
Phase: 3 (Batch C)
Applicable ADRs: 0078; guideline §12

## What to build

- Apply `content-visibility: auto` with `contain-intrinsic-size: auto none auto <estimate>` to transcript turns other than the latest few, and to result rows past the first screen. Never to the current turn or above-the-fold content. It is Baseline newly available and ignored where unsupported, so the fallback is safe.
- Add `scrollbar-gutter: stable` to `#transcript` and `#workspace-region`.
- Change `.ui-skeleton` from an infinite `background-position` shimmer to an opacity pulse. The reduced-motion block still stops it.
- Check that Tab and screen-reader navigation still reach every older turn (a mandatory check for `content-visibility`).

## Acceptance criteria

1. Older transcript turns are skipped for rendering until scrolled near, and keep their size, with no scroll jump
2. Keyboard navigation reaches every earlier turn and its links
3. Opening or closing the workspace does not shift the layout when a scrollbar appears
4. The skeleton animates opacity, not background position

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- Foundation CSS: keep the committed formatting and literal six-digit hex tokens (`guest-kit.test.ts`, `shortlet-design-system.test.ts`). Commit `shortlet-foundations.css` edits before running `test/landing-page.test.ts`, because it fails on any uncommitted change to that file.
- This issue changes `apps/local-guest/src/client.ts`. Never run it alongside another `client.ts` issue (11, 14, 19, 21, 24). Rebuild `client.js` and commit the regenerated `dist/client.js` only.
- Guest UI: finish with captures at 320, 390, 768 and 1280 (light and dark) under `.scratch/ux-guidelines/screenshots/<NN>/`, and a findings file showing no horizontal overflow and no control under 44px (ADR 0078).

## Comments

### ADRs read and applied

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0078 | Reduced motion, 320px reflow, keyboard reachability, no hidden critical content. | AC1-AC4. |
| 0080 | The conversation and standard routes keep the same facts. | The transcript deferral does not remove content or links. |

### Implementation

- `addTurn` marks every turn except the latest six with `.turn--deferred`.
- `#transcript .turn--deferred` uses `content-visibility: auto` with `contain-intrinsic-size: auto none auto 4rem`; the browser reveals a turn when it is scrolled near or focused, so Tab and screen readers still reach it.
- `#transcript` and `#workspace-region` use `scrollbar-gutter: stable`.
- `.ui-skeleton` is an opacity pulse (`ui-pulse`) instead of the `background-position` shimmer.

### Tests and commands

- `npm run check` — 0 errors.
- `npx tsx --test test/guest-long-conversation.test.ts` — 3 tests, 3 passed, 0 failed.
- Real Chrome: `npx tsx --test test/guest-long-conversation-chromium.test.ts` — 1 test, 1 passed, 0 failed (a deferred oldest turn is focusable and readable).
- After committing the CSS: `npx tsx --test test/landing-page.test.ts test/guest-kit.test.ts test/shortlet-design-system.test.ts` — 51 tests, 51 passed, 0 failed.
- `client.js` rebuilt; only the regenerated `dist/client.js` is staged.
- Captures: `npx tsx .scratch/ux-guidelines/capture-24.ts` — 8 long-thread captures at 320/390/768/1280 in light and dark under `.scratch/ux-guidelines/screenshots/24/`; 16 turns defer, no overflow and no visible control under 44px.

## Answer

Older transcript turns now defer rendering until scrolled near while keeping their space and keyboard reachability; scrollbar gutters are stable; and the skeleton animates opacity rather than background position.
