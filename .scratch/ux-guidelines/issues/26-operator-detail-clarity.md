# 26 · Operator detail clarity

Status: resolved
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

### ADRs read and applied

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0041 | Response window starts at delivery; a failed delivery is its own state. | AC2 label wording; the refusal notice is unchanged. |
| 0042 | Operator Active Hours and the response deadline. | AC1/AC2 do not change the deadline or its projection. |
| 0072 | Consequential decisions are versioned commands. | AC3: the `basedOnVersion` guard stays the authority; the guard script is presentation only. |
| 0078 | Readable dates, plain labels, 44px targets. | AC1 and AC2. |

### Reachability of the legacy dashboard (03's question, answered from code)

`renderOwnerDashboardHtml` is still reachable: `GET /` in a non-production handler renders it (`local-owner-server.ts:1560-1566`). It is therefore relabelled, not retired, per the issue's second branch. Its status column now uses the same `requestStatus` label helper, its dates use `formatStayDates`, and "Confirm Booking (Lock Availability)" became "Confirm for the owner".

### Tests and commands

- `npm run check` — 0 errors.
- `npx tsx --test test/operator-detail-clarity.test.ts` — 4 tests, 4 passed, 0 failed.
- Affected: `npx tsx --test test/back-office-request-inbox.test.ts test/back-office-confirm-decline.test.ts test/back-office-home.test.ts test/back-office-calendar.test.ts test/response-window-starts-at-delivery.test.ts` — 18 tests, 18 passed, 0 failed. The calendar and inbox assertions were updated to the new sentence-case labels.

## Answer

The Operator request detail shows human stay dates, every Operator status label is plain sentence case ("Delivery failed", "Payment pending", "Operator hold"), a decision form disables its submit button while in flight while the server's version guard still refuses duplicates, and the legacy dashboard (reachable at `/` in non-production) now uses the same labels and human dates.
