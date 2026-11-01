# Assistant: explain why a sent request, offer or booking can't change in chat

Status: ready-for-agent
Type: AFK
Blocked by: none
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

After a request is sent, the deterministic path answers "make it 4 nights" with `#changeExplanation` (`shortlet-app.ts:1152`): what can't change, why, and what to do instead, ending "Nothing has been changed." (ADR 0005, 0060). The assistant has no equivalent copy; the model may start a new search or imply the booking changed.

## What to build

- Move the four explanation strings to `guest-content.ts`.
- When the task state has a sent request, an offer, a payment or a reservation, and the guest asks to change stay facts, the pack answers with the matching explanation and commits no stay change. The pack decides the stage from the task state; the model only classifies the intent.

## Acceptance criteria

- [ ] AC1: With a sent Booking Request, "add one more night" gives the request explanation and leaves the request unchanged.
- [ ] AC2: With an offer, the offer explanation; with a reservation, the amendment explanation.
- [ ] AC3 failure path: no search runs and no proposal is created on these turns.
- [ ] AC4: Same reply as the deterministic path (parity test), with a cold restore before every event.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0005 | A Booking Request is not a Reservation | AC1 copy |
| 0060 | Versioned amendments | AC2 |
| 0080 | Parity | AC4 |

## Comments
