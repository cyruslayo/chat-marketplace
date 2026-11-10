# 18 · Container queries for kit components

Status: ready-for-agent
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
