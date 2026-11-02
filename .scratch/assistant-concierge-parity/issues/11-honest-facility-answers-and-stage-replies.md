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

### Triage note (agent, 2 Nov 2026)

Blockers: 08 is resolved (commit 1d6fc34). No open blocker.

What the code does today and where it overlaps:
- Issue 08 gives the amenity word table (`stay-vocabulary.ts`, `searchAmenityIdsFor`) and the catalogue `GUEST_AMENITY_IDS`. AC1, AC2 and AC5 can reuse them. A word outside the catalogue (gym, per 08) has no id, so "is there a gym?" needs a separate rule for the answer.
- The assistant has no facility answer today. A parking question goes to the details reply, which lists all amenities (the issue cites `shortlet-assistant-pack.ts:980`). I found no per-question path in the pack.
- The seam from issue 12 is reusable. `answerValidatedTurn` (`assistant-platform.ts`, called in `assistant-runtime.ts` before the planner loop) gives a reply with no planner call and no tool. Facility answers (AC1, AC2) and the stage reply (AC3) can use the same hook. Its order against the `change` answer must be set.
- Overlap with issue 09 AC4 ("with a gym"). Two issues would give two different copies for the same word: "isn't listed, so I can't confirm it" here, and an unsupported-preference note there, with the search going on. Recommended split: a question about a facility is answered here, and a request that includes one is noted in 09. Both ACs must state this.
- AC3 (request-stage reply after submit): nothing in the pack returns the capability text. `#capabilityReply` (`shortlet-app.ts:1096`) is deterministic only, and its copy must move to `guest-content.ts` (ADR 0077). Today a vague turn after submit gets the scope clarification, so AC3 needs the hook and must keep the planner out.
- Adding a facility intent to `CONCIERGE_INTENTS` changes the ADR 0106 list. Issue 12 added `change` and listed it as an owner decision. Either do the same here, or answer with `details` and no new intent.
- AC1 is a closed amenity id chosen by the model from the enum. The answer itself must come from `unit.amenities`, not from the model. The issue should say so.

Decisions needed before ready-for-agent:
1. Gym: facility answer here, or unsupported-preference note in 09 (see above).
2. Facility intent: new closed intent (owner veto, as for 12) or `details`.

Recommended next status: `needs-info` until both are answered, then `ready-for-agent`.
