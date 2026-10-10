# Stay Message Thread domain and store

Status: ready-for-agent
Type: task
Blocked by: 02, 03
Requested: 2 Oct 2026

## Why

The relayed conversation decided by the user and recorded in ADR 0094 needs a domain model that enforces who may write, when, and what, and that can never reach booking state.

## What to build

- `domains/shortlet/src/stay-message-thread.ts`, exported from the index:
  - one thread per Reservation, created lazily on first message
  - parties: the Primary Guest (via the account and Linked Principals) and the Operator's representatives (ADR 0082 grant)
  - `sendMessage(envelope<message.send>, clock)`: checks the party, the window (issue 01), the length and rate limits, and the contact-detail rule (issue 01 answer 5: refuse or mask)
  - `listMessages(threadId, viewer)`: party-checked; marks read per side
  - window evaluated lazily against the clock; values are constructor options with the ADR 0094 defaults
- In-memory and SQLite stores following `booking-state.ts` patterns.
- The module imports nothing that can mutate bookings, contracts, availability or payments (assert in a test).
- Audit entries record thread id, sender role and reason codes, never the body (ADR 0075).

## Acceptance criteria

- AC1: The Primary Guest and an Operator representative with a grant can each send and read messages on that booking's thread.
- AC2: Anyone else (another Guest, another Operator, a revoked representative, an occupant who is not the Primary Guest) is refused, and a missing tenant fails closed.
- AC3: A message before the window opens or after it closes is refused, evaluated from the injected clock.
- AC4: A message over the length or rate limit is refused.
- AC5: A phone number or email in a message is delivered masked and the sender is told why; a message containing a link is refused with a reason (issue 01 answer 5).
- AC6: Sending any message leaves booking, contract, availability and payment tables unchanged.
- AC7: No audit or log entry contains a message body.
- AC8: Threads and messages survive a restart.

## Tests to add/update

New `test/stay-message-thread.test.ts`.

## ADR compliance

0004, 0012, 0060, 0072, 0075, 0082, 0094.
