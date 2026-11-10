# 17 · Targets, small text and state styling hooks

Status: ready-for-agent
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
