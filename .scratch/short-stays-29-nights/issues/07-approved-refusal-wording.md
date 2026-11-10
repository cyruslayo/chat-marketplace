# 07 · Use the owner-approved refusal wording

Status: resolved
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

- **8 Nov 2026, Claude (issue 07).** Files: `domains/shortlet/src/continuous-occupancy.ts` (`CONTINUOUS_OCCUPANCY_WORDING`, one source for the three sentences; the refusal and the fail-closed `UNRESOLVED` both read it), `test/continuous-occupancy.test.ts`, `test/assistant-continuous-occupancy.test.ts`.
- ADRs read and applied: 0077 (one source of guest wording: the sentences are exported from the domain module and nowhere else), 0075 (no identifiers: AC3 test), 0106 (assistant refusals still reach the guest as `CONTINUOUS_OCCUPANCY_REFUSED` / `tool_denial`, from the unchanged `error.message` rethrow in `shortlet-assistant-pack.ts` and `shortlet-stage-handlers.ts`).
- AC1: named test `AC1: Each of the three Continuous Occupancy cases shows its approved sentence exactly` pins all three sentences exactly. The Request to Book path (`test/assistant-continuous-occupancy.test.ts`, short chain) and the draft path (`test/continuous-occupancy.test.ts`, AC6 extended chain and unresolved Property) assert the same text. **Gap:** the assistant path has a dedicated test only for the short-chain sentence; the extended-chain and fail-closed sentences reach the assistant through the same `error.message` rethrow, but no assistant-level test drives them.
- AC2: named test `AC2: No old refusal sentence remains in apps/, domains/ or test/` (file scan).
- AC3: named test `AC3: No guest, request or contract identifier appears in any Continuous Occupancy sentence`.
- Commands and counts:
  - `env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/continuous-occupancy.test.ts test/assistant-continuous-occupancy.test.ts`: 19 tests, 19 pass, 0 fail (run after the final edit).
  - `env -u LLM_API_KEY npm run check`: clean (tsc, cloudflare tsc, test tsc, worker bundle guard).
- Wording as shipped (owner approved 8 Nov 2026, typographic apostrophe in "couldn’t"):
  - Short chain: "These dates run straight on from your other stay at this property, making {total} nights in a row. For 30 nights or more, book one stay for the whole time instead."
  - Extended chain: "These dates run straight on from your other stay at this property, making {total} nights in a row. The longest stay we can book is {max} nights."
  - Fail closed: "We couldn’t check these dates against your other stays at this property. Please try again, or ask us for help."
- Approved unchanged and not touched: "Stays can be at most 180 nights. Please choose 180 nights or fewer." and "Demo terms for a synthetic staging booking:".
- Not committed or regenerated: no screenshots, no dist files.
