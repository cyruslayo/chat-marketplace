# Block and hold Unit availability authoritatively

Status: resolved
Type: AFK
User stories: 69–70

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Give an eligible non-exclusive Operator an authoritative Availability Calendar with immediate Operator Blocks and a 45-minute Operator Hold that may receive one eligible 15-minute extension. Prevent overlapping inventory commitments across every application path.

## Acceptance criteria

- [x] Operator Blocks immediately remove overlapping Open Dates and retain audit provenance.
- [x] Holds expire automatically, allow at most one valid extension, and never exceed 60 minutes.
- [x] Competing holds, blocks, and bookings are protected by real transaction and overlap constraints.
- [x] Web, agent, and support views show the same current availability without owning it locally.

## Completion note

Issue 05 is implemented with an SQLite-backed Availability Calendar rather than process-local authority. Operator Blocks are authoritative, and Operator Holds are explicit, fixed at 45 minutes, allow one 15-minute extension, and have a 60-minute maximum lifetime. Successful Booking Request disclosure creates a 30-minute booking_request_block; operator confirmation atomically transitions that same commitment to payment_pending; and successful card or bank payment atomically transitions that same commitment to non-expiring confirmed_booking. The same commitment ID is preserved across booking_request_block -> payment_pending -> confirmed_booking, while active commitments prevent overlapping inventory through the shared transaction constraint. Current availability is read from the shared authoritative Calendar.

Validation: 323 tests passed, 0 failed across 4 suites; focused availability, Booking Request, Conditional Offer, card-payment, and bank-transfer tests, Weaver vendor verification, and TypeScript checks passed.

## Blocked by

- [Issue 04](04-onboard-and-publish-one-inspected-unit.md)
