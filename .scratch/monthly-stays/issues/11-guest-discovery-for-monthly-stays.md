# Guest discovery for monthly stays: entry points, monthly price and what's included

Status: ready-for-agent
Type: task
Blocked by: 04, 05

## What to build

Make Extended Stays findable and understandable on every guest surface. Follow the AGENTS.md "Guest UI work" rules: kit components only, the same helper for chat and the standalone page, copy from `apps/web-agent/src/guest-content.ts`, and semantic tokens.

- **Entry points:** "On assignment" and "Relocating" on the home and search surfaces. Both lead to the same search with an Extended Stay length preset. The concierge recognises month-length requests in chat.
  - The entry point is an optional tag kept with the lead only, for comparing segments. It is not a required profile field (ADR 0075).
- **Stay card and unit detail** for Extended Stay dates show:
  - the monthly all-in price;
  - the whole-stay All-In Stay Total;
  - the payment plan (first period now, later periods with due dates);
  - the utilities and servicing facts from issue 05.
- **The request review** shows every period, its amount and due date, the Extended cancellation entry and the Notice to End rule, before submission.
- **Copy:** the guest-facing wording for the positioning line, entry points, period and notice terms is confirmed by the user and added to `GUEST_FACT_LABELS`. Don't invent wording; ask.

## Acceptance criteria

- AC1: Choosing "On assignment" or "Relocating" opens a search preset to an Extended Stay length that shows only opted-in units.
- AC2: Every stay card and unit detail for Extended Stay dates shows the monthly price, the whole-stay All-In Stay Total and what's included, identically in chat and on the page.
- AC3: Request review lists every Billing Period with dates, amount and due date, plus the cancellation and notice terms, before the guest can submit.
- AC4: A unit not offering Extended Stays never appears for Extended Stay dates.
- AC5: Screens pass the ADR 0078 checks: no horizontal overflow, targets at least 44px, light and dark. Captures at 320, 390, 768 and 1280 are saved under `screenshots/11/`.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0015 | All-in total everywhere; indicative rates labelled |
| 0066 | Ranking for fit; no sponsored placement |
| 0075 | Segment tag optional and minimal |
| 0077, 0080 | Same canonical content across chat and page; deterministic parity |
| 0078 | Accessible Nigerian launch profile |

## Definition of Done

See `docs/agents/issue-tracker.md`, plus the AGENTS.md capture and overflow checks.

## Comments
