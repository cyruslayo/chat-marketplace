# 02 · Concierge and assistant accept 1 to 29 nights

Status: ready-for-agent
Type: task
Blocked by: 01
Requested: 1 Nov 2026

## What to build

Make the concierge and the assistant runtime take the Short Stay maximum from `MAX_STAY_NIGHTS` (issue 01) instead of the literal 14. Read ADR 0106 first (AGENTS.md, "Concierge assistant path").

- `apps/local-guest/src/assistant/shortlet-assistant-pack.ts`:
  - the `nights` schema maximum of `search_stays` (`:67`) and `prepare_request_draft` (`:167`);
  - `stayToolDefinitions` (`:199`, `:201`): the default maximum without a policy, and the "no policy widening needed" check;
  - the argument checks at `:418` and `:757`. A length outside both ranges stays a rejected tool call (`tool_denial`), never a thrown error that becomes `CONCIERGE_UNAVAILABLE` (ADR 0106).
- `apps/local-guest/src/concierge.ts` `:612–616`: the comment and the two refusal messages already read `MAX_STAY_NIGHTS`; update the comment. **Wording to confirm with the owner before merging:** with the demo policy the message becomes "This demo supports stays up to 29 nights, or 30 to 180 nights.", which describes one continuous range awkwardly. Propose a replacement in Comments and ask; do not invent final copy.
- Chip edits (criteria strip "Edit search") must accept 15 to 29 nights as structured guest input.

## Acceptance criteria

- AC1: With the assistant runtime enabled and a cold restore before every event (new `LocalGuestApp` over the same store), on a fresh thread with a staging-like clock (2026-10-27) and guest, "Ikoyi for 21 nights, 2 guests" searches, shows a discovery surface, and reaches a Request Draft as a Short Stay. Model `test/assistant-cold-journey.test.ts`.
- AC2: Without an Extended Stay policy, the `search_stays` and `prepare_request_draft` schemas offer a maximum of 29 nights; with the demo policy they offer 180.
- AC3: Without a policy, a planner `search_stays` of 30 nights is a rejected tool call (`tool_denial`), not `CONCIERGE_UNAVAILABLE`, and creates no discovery surface.
- AC4: A criteria-strip chip edit to 25 nights reaches `thread.assistantContext` and the runtime facts, and the next search uses 25 nights.
- AC5: Update `test/demo-extended-assistant.test.ts`, which asserts 15 and 29 nights create no discovery surface. 15 and 29 now succeed as Short Stays; 181 nights is still refused.

## ADR compliance

| ADR | Constraint | Where it bites |
|---|---|---|
| 0023 (amended) | Short Stay 1–29 nights | Schema maximum, argument checks (AC2, AC3) |
| 0092 / 0105 | Extended Stay 30–180, policy only | Schema widening with a policy (AC2, AC5) |
| 0106 | Cold restore per request; out-of-range tool calls are `tool_denial`; no deterministic fast path | AC1, AC3 |
| 0093 | Chip nights are structured guest input | AC4 |

## Definition of Done

See `docs/agents/issue-tracker.md`. Record the exact test commands and pass counts in Comments.

## Comments
