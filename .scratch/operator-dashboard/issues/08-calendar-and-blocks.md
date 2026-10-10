# Calendar and date blocks

Status: resolved
Type: task
Blocked by: 01

## What to build

A calendar per apartment, grouped by owner, shows each day's state:
- available;
- request pending;
- Payment Pending;
- booked;
- blocked.

You block the dates an owner tells you are taken, and remove your blocks. ADR 0039 conflict rules apply:
- with no active request, a block takes effect;
- an unconfirmed request must be declined first;
- a confirmed or Payment Pending commitment is refused, because it needs human handling;
- a booked stay can't be overridden.

The domain has no remove-block method today; add one.

## Acceptance criteria

- AC1: For each apartment, a date range shows every day's state from the authoritative Availability Calendar, as text and not colour alone.
- AC2: You can block free dates and the block takes effect immediately; a block over an unconfirmed request is refused with a prompt to decline it first, and over a confirmed, Payment Pending or booked stay it is refused.
- AC3: You can remove a block, and the dates become available again unless another commitment holds them.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0039 | one calendar; block conflict rules |
| 0072 | commands with concurrency and idempotency |
| 0078 | reflow; not colour alone |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Every action asserts the standard failure paths: revoked or expired grant, no session, cross-origin POST, and a stale or expired target.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: money, deadline and legal wording traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No keys, secrets, receipts, account numbers or contact values in logs or telemetry (ADR 0075).
- [x] Walkthrough at 320px, 375px and 1280px, and without JavaScript.
- [x] `npm run check` and `npm test` pass.

## Answer

Delivered on `bo/b8-calendar-and-blocks`, which is stacked on `test/stabilize-real-browser` (issue 12). Tests: `test/back-office-calendar.test.ts`, with one test per AC.

**What was built**
- **Domain** (`domains/shortlet/src/availability.ts`, `availability-store.ts`):
  - `AvailabilityCalendar.releaseOperatorBlock`, the missing remove method. It releases only an active Operator Block, and it takes the same range out of the `Unit.blockedDates` discovery projection, so Guests can find the dates again.
  - `listActiveCommitments` and `findCommitment`.
  - `projectCalendarDays`, which gives each night's state. A night covered by several commitments shows the hardest to displace.
  - `operatorBlockConflict`, the ADR 0039 conflict rules.
  - `addCalendarDays`.
- **Environment** (`local-owner-environment.ts`):
  - `listOperatorCalendars` and `operatorCalendar`: grant-checked, read fresh, with expiry evaluated lazily.
  - `blockOperatorDates` and `removeOperatorBlock`.
  - `BLOCK_REASONS`: the Operator Block reasons from CONTEXT.md, with no free text.
  - `CalendarInputError` (400) and `CalendarRefusalError` (409).
  - `CALENDAR_WINDOW_NIGHTS = 28`, which is presentation only.
  - Audit records `operator_block_added`, `operator_block_refused` and `operator_block_removed`, holding ids, dates and codes only.
- **Server:**
  - GET `/operator/calendar[?from=YYYY-MM-DD]`;
  - POST `/operator/calendar/<unitId>/blocks`;
  - POST `/operator/calendar/<unitId>/blocks/<blockId>/remove`;
  - a Calendar nav link.

  The page groups apartments by owner. Each apartment gets a table of nights with a header per row and column, with every state written out. It also lists the blocks in view and has the block form. There are no scripts on the page.

**Decisions within the ADRs**
- **Block reasons.** A block needs a reason from CONTEXT.md's Operator Block list. Only blocks carrying one of those codes can be removed here. The platform's own blocks (for example ADR 0036, a missed turnover deadline) show as "Set by the platform" and cannot be removed.
- **Nights.** Dates are nights: you enter the first and last blocked night, and the block ends the morning after the last night.
- **Version.** A form's version covers every active commitment on the unit, so any change there refuses a stale form. A replay of an identical block is accepted without creating a second one (ADR 0072).
- **Operator Holds** (ADR 0040) show as "Operator Hold", and a block over one is refused. No hold is created in the pilot today.

**Walkthrough.** Ran `.scratch/operator-dashboard/walkthrough-b8.ts`, the `b8-calendar-walkthrough` launch configuration.
- At 1280, 375 and 320 px there was no horizontal overflow, and no target was smaller than 24 px.
- With a block over a pending request, the page refused it with an "Open the Booking Request" link.
- Blocking and removing dates worked from the page.
- The page has zero `<script>` tags, so it works without JavaScript.

**ADR compliance**

| ADR | Constraint | Where |
|---|---|---|
| 0039 | One calendar; a block takes effect only with nothing overlapping; an unconfirmed request is declined first; Payment Pending needs human handling; a booked stay cannot be overridden | `operatorBlockConflict`; `blockOperatorDates`; AC2 test |
| 0040 | A block does not replace an Operator Hold | `operatorBlockConflict` (`held`) |
| 0036 | Turnover-protection blocks are the platform's | `removeOperatorBlock` refuses `platform_block` |
| 0041, 0044 | Request and payment blocks expire and are evaluated lazily | `listActiveCommitments` runs `#expireStale`; AC1 test |
| 0072 | Versioned, idempotent commands | `#calendarVersion`; block replay; stale refusals |
| 0075 | No free text or guest data in audit | `#recordCalendar`; fixed reason codes |
| 0078 | Text as well as colour; table headers; 44 px targets; 320 px reflow | `apartmentCalendar`; walkthrough |
| 0082 | Only owners you hold a grant for; others are not found | `#apartmentsYouActFor` |
| 0086 | No session: the page redirects to sign-in and actions return 401; cross-origin is rejected with 403 | server routes; AC tests |

**Follow-up.** [13](13-imported-blocks-outside-the-calendar.md): `blocked_dates` from the inventory import never reach the authoritative calendar.
