# ADR 0094: Relayed guest–operator stay messages

Status: ready-for-agent
Type: task
Blocked by: 01
Requested: 2 Oct 2026

## Why

No ADR covers direct Guest–Operator conversation, and `CONTEXT.md` lists "operator message" under _Avoid_ for availability and checkout because a message must never be mistaken for a term change. Adding a message thread needs an explicit decision so it does not erode ADR 0060.

## What to build

- `docs/adr/0094-relay-guest-operator-stay-messages.md`, recording:
  - one Stay Message Thread per Reservation, between the Primary Guest's account and the Operator's representatives (ADR 0082 grants decide who may read and reply)
  - messages are relayed and stored by the platform; contact details are handled per issue 01 answer 5
  - messages never change dates, price, party, checkout, deposit or cancellation; anything like that is redirected to the amendment or support path (ADR 0060, 0033 for late checkout)
  - the window, limits and retention from issue 01
  - web only (ADR 0067); human support can see a thread when a handoff is opened (ADR 0030, 0076)
  - email alerts both ways; operator alerts go to the people covering the response window (ADR 0042)
  - message bodies are not logged or put into concierge interaction state (ADR 0075)
- `domains/shortlet/CONTEXT.md`: add **Stay Message Thread** with an _Avoid_ line, and keep "operator message" in the existing _Avoid_ lists.

## Acceptance criteria

- AC1: ADR 0094 exists and cites 0042, 0060, 0067, 0075, 0076 and 0082.
- AC2: Every number in it traces to issue 01's `## Answer`.
- AC3: The ADR says, in one sentence, that a message never changes booking terms, and names where such requests are redirected.
- AC4: `CONTEXT.md` defines Stay Message Thread without conflicting with existing terms.

## Tests to add/update

None (documentation).

## ADR compliance

0030, 0033, 0042, 0060, 0067, 0075, 0076, 0082.
