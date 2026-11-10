# 24 · Rendering cost of long conversations

Status: ready-for-agent
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
