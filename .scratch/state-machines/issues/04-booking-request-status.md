# 04 BookingRequest: typed records and an exported status union

Status: ready-for-agent
Type: task
Track: B (no behaviour change)
Blocked by: 03

## What to build

In `domains/shortlet/src/booking-request.ts`:

- **Status union.** Export `BOOKING_REQUEST_STATUSES = ["draft", "disclosed", "delivery_failed", "expired", "confirmed", "declined"] as const` and `type BookingRequestStatus = (typeof BOOKING_REQUEST_STATUSES)[number]`.
- **Transition table.** Export `BOOKING_REQUEST_TRANSITIONS`, written as `as const satisfies TransitionTable<BookingRequestStatus>` (from `packages/platform-core/src/state-transition.ts`). It must encode exactly the moves the code makes today:
  - `draft` → `disclosed`
  - `disclosed` → `delivery_failed`, `expired`, `confirmed`, `declined`
  - The other four states are terminal (empty lists).
  - Read every write site to confirm this (`status: "draft"`, `status: "disclosed"`, `req.status = ...`). If the code makes a move not listed here, add it to the table and say so in Comments.
- **Typed records.** Replace `#requests = new Map<string, any>()` with a typed record interface. Search first for an existing interface that fits (for example the durable record in `guest-interaction-store.ts`). There must be no `any` left in the file.
- **One shared rule.** Extract a single helper for the delivered and deadline rule, which is currently repeated in `projectBookingRequestStatus`, `checkAndResolveDeliveryFailure` and the expiry check. Use it in all three places.
- **Typed status field.** Type the `status` field of the durable booking-request record in `domains/shortlet/src/guest-interaction-store.ts` (around line 82, `readonly status: string`) as `BookingRequestStatus`. If loading stored rows needs a narrowing guard, unknown values must keep today's behaviour exactly. Record what that behaviour is in Comments; do not change it here.
- **Map update.** Add the new names in backticks to the BookingRequest row of `docs/agents/state-machines.md`, so `test/state-machine-inventory.test.ts` stays green.

Do not change any guard, error string or decline behaviour (the late-decline rule is owner question 1).

## Acceptance criteria

1. Characterisation, success paths: each status move the code makes today still produces the same status.
2. Characterisation, refusal paths: each refused move still produces today's error text. Examples are declining a non-disclosed request and confirming after the deadline.
3. Every move the code makes is listed in `BOOKING_REQUEST_TRANSITIONS`. A test drives each write path and asserts `canTransition(table, from, to)`.
4. There is no `any` in `booking-request.ts`, and `npm run check` is clean.

## Tests

1. **Write the characterisation tests first**, in `test/booking-request-transitions.test.ts`. Reuse `test/helpers/booking-request-manager.ts`. They must pass before any refactor.
2. **Re-run** every test file whose name contains `booking-request`, plus `test/state-machine-inventory.test.ts`.
3. **Run `npm run check`.**

ADRs: 0041, 0043, 0075.

## Comments
