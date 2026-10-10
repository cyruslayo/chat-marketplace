# Request inbox: deadlines and owners

Status: resolved
Type: task
Blocked by: 01

## What to build

The inbox is built around the 30-minute response window, across all owners.

- Awaiting requests come first, ordered by deadline.
- Each row shows the owner, apartment, guest name, dates, party size, All-In Stay Total, the absolute WAT deadline and the time left, all from server time.
- A request past its window shows as expired when read.
- Delivery Failed is shown as its own state.
- Reminders at 10 and 25 minutes are shown in the page only (D2).

## Acceptance criteria

- AC1: Requests awaiting a response come first, ordered by deadline, each showing its owner and apartment, the absolute WAT deadline, and the time left from server time.
- AC2: A request whose window has passed shows as expired on the next read without a background job and cannot be confirmed.
- AC3: A request that failed delivery is shown as Delivery Failed, never as a missed response.
- AC4: At 10 and 25 minutes the request shows a reminder state announced once, and without JavaScript the absolute deadline is still shown.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0041 | 30-minute window; reminders at 10 and 25 minutes (in-page only, D2) |
| 0043 | Delivery Failed is not a timeout |
| 0077 | deadlines projected, never recalculated |
| 0080 | works without JavaScript |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Every action asserts the standard failure paths: revoked or expired grant, no session, cross-origin POST, and a stale or expired target.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: money, deadline and legal wording traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No keys, secrets, receipts, account numbers or contact values in logs or telemetry (ADR 0075).
- [ ] Walkthrough at 320px, 375px and 1280px, and without JavaScript.
- [ ] `npm run check` and `npm test` pass.

## Answer

Resolved on branch `bo/b2-request-inbox` (stacked on B1).

- **Lazy expiry:** already present. `BookingRequestApplication.getArtifact` resolves expiry and delivery failure against the injected clock on every read, and `listOperatorRequestArtifacts` reads through it. AC2 asserts that the stored status is still `disclosed` until the next read.
- **Constants:** `domains/shortlet/src/booking-request.ts` now names `TECHNICAL_DELIVERY_WINDOW_MINUTES` (5, ADR 0043), `OPERATOR_RESPONSE_WINDOW_MINUTES` (30, ADR 0041) and `OPERATOR_RESPONSE_REMINDER_MINUTES` ([10, 25], ADR 0041). The disclose step uses the first two.
- **Reminders:** `operatorResponseReminderDue(request, now)` measures back from the projected deadline, so a reminder can never disagree with the deadline shown (ADR 0077).
- **Inbox (`operatorInboxHtml`):**
  - Rows appear in this order: awaiting a response, then Delivery pending, then everything else, each group sorted by deadline (sort in `listOperatorRequestArtifacts`).
  - Each row shows the guest name, apartment, owner, dates, nights, party size, All-In Stay Total, "Respond by <absolute WAT>", and minutes left from `env.clock()`.
  - Reminder rows carry `data-reminder`, reading "Reminder: N minutes left" or "Final reminder: N minutes left".
- **Guest name:** it now reaches a granted operator's projection (`apps/web/src/booking-request-artifact.ts`, `operatorGranted`). Occupant names stay Guest-only.
- **Delivery Failed:** it is now listed with its own label and a `stale` tone. It is never labelled expired, and it is not on home. The audit trail has `booking_request.delivery_failed` and never `booking_request.expired`. An undelivered request shows "Delivery pending" with no response clock (ADR 0041, where the clock starts on acceptance).
- **Announced once:** there is one `role="status"` region per page, carrying `data-announce` and `data-announce-key` (`requestId:minute`).
  - A small inline script speaks each key only once, remembered in `sessionStorage`.
  - Without JavaScript, every row still shows the reminder, the absolute deadline and the time left.
- **Fixture:** `createDemoIncomingBookingRequest({ delivered: false })` leaves a request in Delivery Pending, for tests.

**ADRs:**

| ADR | Where it's reflected |
|---|---|
| 0041 | Named 30-minute window and reminders at 10 and 25 minutes. Reminders are in-page only (D2). No response clock before delivery. |
| 0043 | Delivery Failed is its own label and tone. No timeout record. Not actionable (confirm returns 409). |
| 0077 | Deadline taken from `operatorResponseDeadlineAt`, never recalculated. Reminders derived from it. `<time datetime>` gives the projected instant. |
| 0080 | Server-rendered rows. The script only adds the spoken announcement. |

**Definition of Done**
- Each AC has one named test.
- AC2 and AC3 assert these failure paths:
  - expired target: 409;
  - Delivery Failed target: 409;
  - no session: 401;
  - cross-origin: 403;
  - revoked grant hides the owner's requests.
- Walkthrough of the inbox with awaiting, reminder at 10, reminder at 25, expired and Delivery Failed rows: no overflow at 320, 375 or 1280, and no target under 44px. Announced once on a fresh load, silent on reload.
- `npm run check` is clean. `npm test` gave 1192 passed and 0 failed.

**Note for later:** ADR 0043 says acceptance starts a fresh 30-minute window. The domain sets the deadline to disclosure + 30 even when delivery happens later. Pilot requests deliver at disclosure, so the two agree today. This was left as-is rather than recalculated in the view (ADR 0077).
