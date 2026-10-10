# Start the 30-minute response window at delivery, not disclosure

Status: resolved
Type: follow-up
Blocked by: none
Found in: B2 (26 Sept 2026)

## Problem

ADR 0043 says acceptance of delivery "starts a fresh full 30-minute operator window". ADR 0041 agrees: the clock starts only after acceptance by at least one operator-delivery channel.

The domain does something different. `BookingRequestManager` in `domains/shortlet/src/booking-request.ts`, in its disclose step, sets:
- `operatorResponseDeadlineAt` = disclosure + `OPERATOR_RESPONSE_WINDOW_MINUTES`;
- `deliveryDeadlineAt` = disclosure + `TECHNICAL_DELIVERY_WINDOW_MINUTES`.

`markDelivered` records `deliveredAt` but never moves the response deadline.

Today the two agree, because pilot requests are delivered at disclosure (`autoDeliver`). They diverge as soon as delivery happens later. For example, a request delivered at minute 4 would expire at minute 30 instead of minute 34, taking 4 minutes from the operator. It could also count as an operator timeout, which ADR 0041 reserves for genuine active-hours timeouts.

B2 deliberately did not correct this in the back office, because deadlines are projected and never recalculated in a view (ADR 0077). The back office already measures reminders back from the projected deadline (`operatorResponseReminderDue`), so it will follow a corrected deadline automatically.

## Decision (28 Sept 2026)

ADR 0041 and ADR 0043 settle the behaviour, so only the representation needed choosing.

- **Response deadline.** While a request is in Delivery Pending it has no response deadline. `operatorResponseDeadlineAt` stays a string, because its SQLite column is `NOT NULL` and a rebuild would touch live pilot databases. Until delivery it holds the 5-minute delivery deadline. It is never shown as a response deadline (every projection checks `delivered`) and never enforced as a timeout. `markDelivered` sets it to delivery + 30 minutes.
- **The inventory block** lasts at most the 5-minute delivery window in Delivery Pending (ADR 0043). Acceptance extends it, forward only, to the new response deadline, so the dates stay held for the whole window (ADR 0041).
- **Found while fixing.** `checkAndResolveExpiry` checked only the response deadline. An undelivered request that nobody had resolved as Delivery Failed could therefore be marked `expired`, an operator timeout. It is now resolved as Delivery Failed.

## Acceptance criteria

- AC1: A request delivered after disclosure expires 30 minutes after `deliveredAt`, not after `disclosedAt` (ADR 0043).
- AC2: Before delivery, no response deadline or reminder is shown or enforced. Delivery Failed never becomes an operator timeout (ADR 0041).
- AC3: The inventory block is released at the new expiry, and the projected deadline is the single source for the back office and the Guest (ADR 0077).

## ADRs

| ADR | Constraint |
|---|---|
| 0041 | The response clock starts on channel acceptance; only genuine timeouts drive enforcement |
| 0043 | Acceptance starts a fresh full 30-minute window |
| 0077 | Deadlines are projected, never recalculated |

## Answer

Delivered on `bo/b09-response-window-at-delivery`, stacked on `bo/b14-uphold-complaint-refund`. The tests are in `test/response-window-starts-at-delivery.test.ts`, one per AC.

- **Domain** (`booking-request.ts`):
  - Disclosure sets the deadline and block expiry as above.
  - `markDelivered` starts the fresh window and extends the block.
  - `checkAndResolveExpiry` never expires an undelivered request.
- **Availability:**
  - `createBookingRequestBlock` takes an optional `expiresAt`.
  - New `AvailabilityCalendar.extendBookingRequestBlock` and store method: only an active, unexpired request block, and only forward.
- **Pilot behaviour is unchanged.** Requests are delivered at disclosure (`autoDeliver`), so the deadline and block are still disclosure + 30 minutes.
- **Test fixtures:** `setupBookingRequestManager` moved to `test/helpers/booking-request-manager.ts`, shared with `submit-and-resolve-timed-booking-request.test.ts`.
- **No browser walkthrough.** Nothing on screen changes: the pilot delivers at disclosure, and the back office cannot mark a late delivery. The B2 inbox tests keep covering how Delivery Pending is shown.

