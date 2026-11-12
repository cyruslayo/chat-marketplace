# 20 · Discovery card and Unit detail hierarchy

Status: ready-for-agent
Type: task
Blocked by: none (05 resolved 12 Nov 2026)
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

### Decision from issue 05 (12 Nov 2026): re-scope

Reason: the Unit detail on the standard route has no Request to Book action (P1, row 22), and the search-to-request path is otherwise the largest real hierarchy cluster, so the scope grows rather than shrinks. Matrix rows now covered (`.scratch/ux-guidelines/evidence-matrix.md`):

- Row 22 (P1): standard Unit detail has no Request to Book; the sticky bar offers only "Back to search results" or a link to `/` that opens no draft. Covers AC2 and AC3 directly (confirmed on staging by the orchestrator, 12 Nov).
- Row 6 (P3): the criteria strip truncates and hides nights and party size at 390.
- Row 7 (P3): the criteria form fills the first screen above the results.
- Row 9 (P2): zero-results assistant text "I found 0 eligible places in Lagos ... view the details below" with no refinement control. Covers the §5 zero-results suggestions.
- Row 10 (P2): the card's "Why it fits" repeats the inspection date, and the detail caption gives the full inspection scope with no disclosure.
- Row 26 (P2, unverified): total h2 hierarchy on detail, code only; judge it in the 20 captures.
- Row 28 (P2): "Indicative nightly rate" leads on detail without a quote; the total should lead.

AC1 (one primary action per card): row 7 shows one primary "View apartment" on the result card, so the card rule holds in the evidence. The problem is the criteria above the results, not the card.

Dropped from this issue: real Unit photography (row 11, now `proposed:`), the terms density (row 46, `proposed:`), and the Operator rows (03).

Acceptance criteria are unchanged. Status unchanged.
