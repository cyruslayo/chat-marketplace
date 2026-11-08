# 07 · Use the owner-approved refusal wording

Status: ready-for-agent
Type: task
Blocked by: none
Requested: 8 Nov 2026

## What to build

The owner approved this wording on 8 Nov 2026. Replace the Continuous Occupancy refusals from issue 06 (in `domains/shortlet/src/continuous-occupancy.ts`) with these sentences, exactly as written (typographic apostrophe in "couldn’t"):

| Case | Approved sentence |
|---|---|
| A chain of Short Stays over 29 nights | These dates run straight on from your other stay at this property, making {total} nights in a row. For 30 nights or more, book one stay for the whole time instead. |
| A chain with an Extended Stay over the maximum | These dates run straight on from your other stay at this property, making {total} nights in a row. The longest stay we can book is {max} nights. |
| The check could not run (fail closed) | We couldn’t check these dates against your other stays at this property. Please try again, or ask us for help. |

- `{total}` is the chain total; `{max}` is the policy's `maximumNights`. "30" stays derived from `MAX_STAY_NIGHTS + 1`.
- **Approved unchanged:** the concierge refusal "Stays can be at most 180 nights. Please choose 180 nights or fewer." and the demo terms prefix "Demo terms for a synthetic staging booking:". Do not change them.
- Update every test that asserts the old sentences. Keep the sentences in one place (the domain module) so chat, page and assistant show the same words (ADR 0077).

## Acceptance criteria

- AC1: Each of the three cases shows its approved sentence exactly, on the Request to Book button path and through the assistant (a `tool_denial` whose reply is the sentence).
- AC2: No old refusal sentence remains in `apps/`, `domains/` or `test/`.
- AC3: No guest, request or contract identifier appears in any sentence (ADR 0075).

## ADR compliance

| ADR | Constraint |
|---|---|
| 0077 | One source for guest wording |
| 0075 | No identifiers in guest text or logs |
| 0106 | Assistant refusals stay `tool_denial` |

## Definition of Done

See `docs/agents/issue-tracker.md`. Record commands and pass counts in Comments.

## Comments
