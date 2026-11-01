# Replace the YYYY-MM-DD clarification and its keyword check

Status: ready-for-agent
Type: AFK
Blocked by: none
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

- `GUEST_ASSISTANT_COPY.dateClarification` is "Please give me the check-in date as YYYY-MM-DD." (`guest-content.ts:29`). Guests don't write ISO dates, and the server already reads "20 November".
- `renderShortletReply` picks it with a keyword regex: `/\b(next friday|next week|tomorrow|next month)\b/` (`shortlet-assistant-pack.ts:958`). That is a keyword path in the reply, and it misses every other relative phrase.

## What to build

- Use the plain-word copy already used for rejected planner dates (`datesClarification`) or a shorter variant, in `guest-content.ts`.
- Remove the keyword regex; choose the clarification from the reply plan and the tool outcome only.
- Update `SHORTLET_PROMPT_SECTION` so it no longer asks the model to request YYYY-MM-DD (until issue 04 lands: "ask for the day and month").

## Acceptance criteria

- [ ] AC1: No guest-facing string contains "YYYY-MM-DD".
- [ ] AC2: A relative date turn on the assistant path gets the plain-word clarification.
- [ ] AC3: `renderShortletReply` has no phrase list for dates.
- [ ] AC4: `test/shortlet-assistant-evals.test.ts` (line 95 and Eval 18) is updated to the new copy, and still asserts that no search runs.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0106 | No deterministic in-scope fast path; dated clarification on rejection | AC2, AC3 |
| 0077 | Copy from one module | AC1 |

## Comments
