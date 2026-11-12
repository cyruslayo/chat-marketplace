# 20 · Discovery card and Unit detail hierarchy

Status: needs-triage
Type: task
Blocked by: 05
Phase: 2 (Batch B)
Applicable ADRs: 0015, 0102; guideline §4 progressive disclosure, §5

## What to build

Apply the discovery and Unit detail rows in §5: Unit, area, capacity, All-In Stay Total and one "View" primary action per card, and an images, facts, total, Request to Book scan order on detail. The scope is confirmed by 05 from the 01 and 02 evidence; stay within the existing kit.

## Acceptance criteria

1. Each result card has exactly one primary action
2. On Unit detail the total and Request to Book appear before optional details at 390
3. Chat and standard routes show the same order

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- Guest UI: finish with captures at 320, 390, 768 and 1280 (light and dark) under `.scratch/ux-guidelines/screenshots/<NN>/`, and a findings file showing no horizontal overflow and no control under 44px (ADR 0078).

## Comments
