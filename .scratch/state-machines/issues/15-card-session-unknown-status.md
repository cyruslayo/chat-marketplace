# 15 An unknown card-session status fails closed

Status: ready-for-agent
Type: task
Track: C
Blocked by: none

## Defect

`domains/shortlet/src/guest-interaction-store.ts` has a mapper that turns a stored card checkout session row into a session, near line 1280: `row.status === "completed" ? ... : "initiated"`. Any stored status it does not recognise becomes `"initiated"`. A corrupt or unexpected row is therefore treated as a live checkout, which fails open.

## Fix

- Map only the four known statuses, from the union in `domains/shortlet/src/card-payment.ts`: `initiated`, `completed`, `expired` and `failed`.
- Make an unknown value throw `new Error("Unknown card checkout session status")`. The message must not include ids or row data (ADR 0075).
- Check every caller of the mapper, and confirm the throw comes out as a refusal, not a crash in an unrelated flow. Record what you find in Comments.

## Acceptance criteria

1. A stored row with each of the four known statuses loads with that status.
2. A stored row with an unknown status throws "Unknown card checkout session status", and the message contains no ids.

## Tests

- **New test:** `test/card-session-status-row.test.ts`.
  - Use the store's SQLite test setup. Look in `test/helpers/temporary-database.ts` and the existing `guest-interaction-store` tests.
  - Write a raw row with `status = 'bogus'`, then load it.
- **Re-run:** the tests that match `card-payment` or `guest-interaction-store`.
- **Then:** `npm run check`.

ADRs: 0046, 0075.

## Comments
