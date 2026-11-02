# Assistant: ask for missing criteria in order, with quick-reply chips

Status: ready-for-agent
Type: AFK
Blocked by: none
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

The deterministic path asks where, who, when, then nights, one at a time, with `quickRepliesFor` chips (issue 11 AC3, `concierge.ts:130`, `shortlet-app.ts:1055`). The assistant's clarifications are fixed sentences (`GUEST_ASSISTANT_COPY.stayClarification`, `safeClarification`) with no chips, and `quickReplies` never appears in `apps/local-guest/src/assistant/`.

## What to build

- When the assistant clarifies (a `clarify_stay` reply plan or a stay-details `tool_denial`), the pack names the next missing criterion from the task state and the result carries `quickRepliesFor(next)`.
- The "when" chips must not offer relative dates until issue 04 lands; until then offer the date chip.

## Acceptance criteria

- [ ] AC1: "Apartment for 2" with no area offers the area chips.
- [ ] AC2: With area and guests known, the reply asks for dates and offers the date choice.
- [ ] AC3: Tapping a chip fills that criterion in the assistant task state.
- [ ] AC4 failure path: no chips appear on an out-of-scope or support reply.
- [ ] AC5: Chips meet the 44px target (ADR 0078) in the chat workspace at 320 and 1280.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0078 | 44px targets | AC5 |
| 0106 | Chip input is structured guest input | AC3 |
| 0080 | Parity | AC1, AC2 |

## Comments
