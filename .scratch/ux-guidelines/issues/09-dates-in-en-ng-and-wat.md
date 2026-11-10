# 09 · Dates in en-NG and WAT everywhere

Status: resolved
Type: task
Blocked by: none
Phase: 1 (Batch A)
Applicable ADRs: 0092 (dates), guideline §9 local conventions

## What to build

- `formatStayDates` (`apps/web-agent/src/booking-presentation.ts:24`) uses `en-GB`. Use `en-NG`, keeping UTC for date-only stay dates.
- Audit every `toLocaleDateString`, `toLocaleTimeString`, `toLocaleString` and `Intl.DateTimeFormat` call under `apps/web-agent`, `apps/web`, `apps/local-guest` and `apps/local-owner`. Contractual times use `Africa/Lagos` with WAT shown; date-only values use UTC. List each call in Comments with its decision.
- Leave Operator ISO dates to issue 26 (only list them here).

## Acceptance criteria

1. Stay dates render with the en-NG locale
2. Every guest-visible time-of-day value is in Africa/Lagos and labelled WAT
3. A test pins the date and time format at a DST-free instant and at the UTC day boundary

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.

## Comments

### ADRs read and applied

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0092 | Contractual dates are authoritative; guest copy may say months but contracts count nights. | AC1/AC3 stay dates and date-only formatting. |
| 0078 | English (Nigeria), `en-NG`, `Africa/Lagos` displayed as WAT; absolute deadlines. | AC1, AC2, AC3. |
| 0106 | Date authority is fail closed; display never grants authority. | The model context day string remains display-only. |
| 0055 | The 90-day Booking Horizon is a date rule, not a display rule. | No display change; the date resolver is untouched. |

### Audit of every date/time formatter

| Call | Decision |
| --- | --- |
| `apps/web-agent/src/booking-presentation.ts:24` `formatStayDates` | **Changed** `en-GB` → `en-NG`; stays `timeZone: "UTC"` because it is a date-only stay date. |
| `apps/web-agent/src/booking-presentation.ts:81` `formatTicketDate` | en-NG, UTC, date-only. No change. |
| `apps/web-agent/src/guest-content.ts:407` `formatGuestDate` | en-NG, UTC, date-only. No change. |
| `apps/web-agent/src/deposit-claim-a2ui.ts:8` `wat` | en-NG, Africa/Lagos, labelled WAT. No change. |
| `apps/web/src/ui-kit.ts:19` `formatWatDateTime` | en-NG, Africa/Lagos, labelled WAT. No change. |
| `apps/web/src/deposit-claim-artifact.ts:11` `viewerDeadlineWAT` | en-NG, Africa/Lagos, labelled WAT. No change. |
| `apps/local-guest/src/concierge.ts:229` day parts | en-NG, UTC, date-only. No change. |
| `apps/local-guest/src/assistant/shortlet-assistant-pack.ts:1460` `formatDayKey` | **Changed** `en-GB` → `en-NG`; UTC date-only, model context only. |
| `apps/local-owner/src/local-owner-server.ts:610` payout date | en-NG, UTC, date-only. No change. |
| `apps/local-owner/src/local-owner-server.ts:615` `lagosToday` | en-CA, Africa/Lagos, machine date key (not shown). No change. |
| `apps/local-owner/src/local-owner-server.ts:734` date label | en-NG, UTC, date-only. No change. |
| `apps/local-owner/src/back-office-view.ts:71` WAT timestamp | en-NG, Africa/Lagos, labelled WAT. No change. |
| `apps/local-owner/src/local-owner-environment.ts:460` `lagosCalendarDate` | en-CA, Africa/Lagos, machine date key. No change. |

The money `toLocaleString` calls in `shortlet-assistant-pack.ts` and `scripted-assistant-model.ts` are not dates; they are left to the money-format effort (issue 08 fixed the A2UI builders). The Operator detail's raw ISO check-in/check-out is issue 26's scope and is not one of these calls.

### Tests and commands

- `npm run check` — 0 errors.
- `npx tsx --test test/guest-date-format.test.ts test/guest-money-format.test.ts test/assistant-cold-journey.test.ts` — 11 tests, 11 passed, 0 failed.
- Affected: `npx tsx --test test/manual-transfer-with-receipt.test.ts test/guest-payment-choice.test.ts test/back-office-request-inbox.test.ts` — 13 tests, 13 passed, 0 failed.

## Answer

Stay dates and calendar days now render with `en-NG`. Contractual times remain `Africa/Lagos` and are labelled WAT. Date-only values stay in UTC, so the calendar date never shifts at the UTC day boundary. A test pins the WAT output at two DST transition instants and at the UTC day boundary, and a source audit proves every guest time-of-day formatter names `Africa/Lagos`.
