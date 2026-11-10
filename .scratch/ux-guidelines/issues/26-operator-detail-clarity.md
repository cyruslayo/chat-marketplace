# 26 · Operator detail clarity

Status: ready-for-agent
Type: task
Blocked by: 03
Phase: 4 (Batch D)
Applicable ADRs: 0041, 0042, 0078; guideline §3 Operator, §5 Operator rows

## What to build

All in `apps/local-owner/src/local-owner-server.ts`:

- The request detail shows raw ISO check-in and check-out (~353). Use `back-office-view.ts` WAT and date helpers.
- "Delivery Failed" (status map ~174-182): use a sentence-case plain label consistent with the others.
- Disable Confirm and Decline while the form submits (progressive enhancement). Keep the server `basedOnVersion` guard and `refusalNotice` as the authority.
- Legacy `renderOwnerDashboardHtml` (~1150-1190) shows "disclosed" and "Confirm Booking (Lock Availability)". Retire it if 03 shows it is unreachable; otherwise relabel it with the new inbox's words.

## Acceptance criteria

1. Operator request detail shows human dates, not ISO strings
2. Every Operator status label is plain sentence case
3. A second Confirm while the first is in flight is not sent, and the server still refuses a duplicate decision
4. The legacy dashboard is removed or shows no internal status names

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- Guest UI: finish with captures at 320, 390, 768 and 1280 (light and dark) under `.scratch/ux-guidelines/screenshots/<NN>/`, and a findings file showing no horizontal overflow and no control under 44px (ADR 0078).

## Comments
