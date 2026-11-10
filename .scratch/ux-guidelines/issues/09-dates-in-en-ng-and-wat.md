# 09 · Dates in en-NG and WAT everywhere

Status: ready-for-agent
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
