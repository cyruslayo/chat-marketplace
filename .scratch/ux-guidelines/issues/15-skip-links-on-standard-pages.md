# 15 · Skip links on standard pages

Status: ready-for-agent
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
