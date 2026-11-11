# 18 · Container queries for kit components

Status: resolved
Type: task
Blocked by: none
Phase: 2 (Batch B)
Applicable ADRs: 0078 (reflow); guideline §7

## What to build

At 64rem and wider the workspace is 560px (760px for discovery) beside the conversation. Kit components that switch on viewport width (`.ui-compare` ~L513, `.ui-facts` ~L734, plus `.ui-stay-card` and `.ui-action-bar`) therefore pick the wide layout in a narrow column.

- Make `#workspace-region` and the standard-page main region `container-type: inline-size` (Baseline widely available; no fallback needed).
- Switch those components' layout rules from `@media` to `@container`, keeping the same breakpoints in rem.

## Acceptance criteria

1. In the 1280 split view, compare and facts use their narrow layout inside the 560px workspace
2. On a 1280 standard page with a wide main region, they use the wide layout
3. No overflow at 320 in chat or on a standard page

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
| 0078 | 320px reflow and no clipped controls. | AC1-AC3 and the captures. |
| 0081 | Weaver output is styled by the shared kit. | All changes stay in the kit block and the shell's layout rules. |
| 0080 | Chat and standard routes carry the same facts. | Details live in §18 instead of the Comments |

### Implementation

- `.ui-page` and `#workspace-region` are `container-type: inline-size`, so their children query the column they are in.
- `.ui-compare` and `.ui-facts` use `@container (max-width: 47.499rem)`. The reading column is 560px (760px discovery), and the workspace cell is ~740px content at 1280; the old 29.999rem viewport query never fired inside it. A 760px standard page is above 759.984px, so it keeps the wide layout.
- The discovery `.stay-grid`/`.ui-result-rows` layout switches in the shell moved from `@media` to `@container`.

### Tests and commands

- `npm run check` — 0 errors.
- Real Chrome: `npx tsx --test test/guest-container-queries-chromium.test.ts` — 3 tests, 3 passed, 0 failed (narrow in the 1280 workspace, wide on a 1280 standard page, no 320 overflow).
- After committing the CSS: `npx tsx --test test/landing-page.test.ts test/guest-kit.test.ts test/shortlet-design-system.test.ts` — 51 tests, 51 passed, 0 failed.
- Captures: `npx tsx .scratch/ux-guidelines/capture-18.ts` — discovery, comparison and search-page captures at 320/390/768/1280 in light and dark under `.scratch/ux-guidelines/screenshots/18/`; findings show no horizontal overflow and no visible control under 44px.

## Answer

Kit layout now follows its column: at 1280 the compare and facts stack inside the workspace, while a wide standard page keeps the two- and three-column layouts. There is no 320px overflow in chat or on the standard page.
