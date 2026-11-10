# 27 · Extended Stay schedule on the offer and payment screens

Status: ready-for-agent
Type: task
Blocked by: none
Phase: 4 (Batch D)
Applicable ADRs: 0092 (Extended Stays, Billing Periods), 0093, 0015; guideline §11

## What to build

Extended Stay schedule lines (`apps/web-agent/src/extended-stay-presentation.ts`) appear on the draft, review and `/bookings/periods/:offerId`, but not on the offer or payment screens (`offer-presentation.ts`, `payment-presentation.ts`, `conditional-offer-a2ui.ts`).

- Show on the offer and payment screens, from projection fields only: the full contracted date range and All-In Stay Total, then each Billing Period's dates, amount and due date.
- The schedule page repeats "This is the first Billing Period only" after later periods are paid. Make the wording follow each period's state.
- Do not add "not charged automatically" or Notice to End text here. That is issue 28.

## Acceptance criteria

1. The Extended Stay offer shows the full range, the All-In Stay Total and every Billing Period with its due date
2. The Extended Stay payment screen shows which period is being paid and the later periods
3. The schedule page wording matches each period's paid or due state
4. A Short Stay offer is unchanged
5. Chat and standard routes show the same schedule

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- Guest UI: finish with captures at 320, 390, 768 and 1280 (light and dark) under `.scratch/ux-guidelines/screenshots/<NN>/`, and a findings file showing no horizontal overflow and no control under 44px (ADR 0078).

## Comments
