# Assistant: answer facility questions from the listing, and reply for the booking stage

Status: needs-triage
Type: AFK
Blocked by: 08
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

- The deterministic `#stageReply` (`shortlet-app.ts:1120`) answers "is there parking?" from `unit.amenities` only: "Yes: <title> lists Parking" or "Parking isn't listed for <title>, so I can't confirm it." The assistant's details reply lists all amenities (`shortlet-assistant-pack.ts:980`) but gives no per-question answer, so the honest "not listed" answer depends on the model.
- `#capabilityReply` (:1166) tells the guest what they can do at each stage (request with the Operator, offer ready, payment, booking). The assistant has no equivalent.

## What to build

- A pack reply for facility questions on the selected stay, using the shared amenity table (issue 08) and the same copy.
- Stage-aware fallback copy in the pack's stage handlers, reusing the `#capabilityReply` text (moved to `guest-content.ts`).

## Acceptance criteria

- [ ] AC1: With a stay selected, "is there parking?" gives the listed answer for a unit that lists parking.
- [ ] AC2 failure path: "is there a gym?" gives the "isn't listed, so I can't confirm it" answer and never says yes.
- [ ] AC3: After submit, a vague turn gets the request-stage reply.
- [ ] AC4: Guest text is never echoed in the reply (ADR 0075).
- [ ] AC5: Same answer as the deterministic path (parity test).

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0080 | Parity | AC5 |
| 0075 | No echo of guest text | AC4 |
| 0077 | Copy from one module | AC1 to AC3 |

## Comments
