# The assistant never dead-ends: re-ask the open question instead of the generic fallback

Status: resolved
Type: AFK
Blocked by: 57 (and 58 for structured chips on the re-ask)
Requested: 9 Nov 2026

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md). Batch: chat hardening, issues 56–62.

## Why

When the classifier says `unclear`, or fails, the guest gets the fixed `ASSISTANT_CONTROL_COPY.unavailable` ("Please tell me what you need for your stay. You can also use the standard search and booking pages."). Their input is discarded and they get no chips (`assistant-runtime.ts` ~1101-1107). That is a dead end: the guest has to guess what to type next. On staging this followed a question the assistant itself had asked ("how many guests are staying?").

Exploration also found an ordering side effect. `settlePendingGuestFacts` (`assistant-runtime.ts` ~1078-1079, via `settlePendingStayDate` in `shortlet-assistant-pack.ts:521-544`) runs **before** the scope verdict. It always deletes `pendingDate`, and a tapped "Yes" commits the check-in even when the classifier then refuses the turn.

## What to build

1. **Re-ask.** With `openQuestion` set (issue 57) and a verdict that is `unclear`, missing or failed (not `out_of_scope` and not a risk verdict), return the fixed copy for that question plus its chips (structured, from issue 58), instead of `unavailable`.
   - Add the copy to `GUEST_ASSISTANT_COPY` (`apps/web-agent/src/guest-content.ts`), one sentence per code. Example: `party_size` → "How many guests are staying?"; `pick_result` → "Which one would you like to see?"
   - `controlOutcome` stays `scope_unavailable` (or the failure outcome) for telemetry. No model output is used and no state is committed.
2. **Recovery chips.** With no open question, the generic `unavailable` reply carries closed, stage-appropriate recovery chips from the pack, e.g. the current area or "Search again" in discovery. Out-of-scope `redirect` is unchanged.
3. **Settle after the verdict.** Run `settlePendingGuestFacts` only after an in-scope or mixed verdict. A refused turn leaves `pendingDate` and `pendingLocation` exactly as they were, so the show-back and its chips can be re-asked.
4. The quota refusal and `CONCIERGE_UNAVAILABLE` keep their existing copy. Add the recovery chips only where the turn path can still continue.

## ADRs

| ADR | Constraint | Where |
|---|---|---|
| 0106 | Fixed platform copy on refusal. No model text. No keyword fast path. Closed telemetry outcomes. Date authority needs a confirmed show-back. | Steps 1–3 |
| 0075 | No guest text echoed in fixed copy. | Copy |
| 0077 | Guest copy lives in `guest-content.ts`. | Step 1 |

## Acceptance criteria

New tests in `test/assistant-open-question.test.ts`, or a new `test/assistant-no-dead-ends.test.ts`. Assistant on, cold restore before every event, 2026-10-27 clock, staging guest; warm and cold.

- [x] Open question `party_size` plus an `unclear` verdict: the reply is the party-size question with the who chips, and the outcome is `scope_unavailable`.
- [x] The same with a classifier failure (invalid JSON on both attempts): the same re-ask.
- [x] `unclear` with no open question: the generic copy plus recovery chips.
- [x] `out_of_scope`: the redirect copy, unchanged, with no re-ask.
- [x] A tapped "Yes" on a date show-back that the classifier refuses leaves `pendingDate` intact and commits no check-in.
- [x] A re-ask commits no task state (the runtime state is the same before and after).

## Verification

`npm run check`, the new tests, `test/assistant-scope-controls.test.ts`, `test/assistant-date-phrases.test.ts` and `test/assistant-cold-journey.test.ts`. Use `env -u LLM_API_KEY`. Record the counts in Comments.

## Comments

- 9 Nov 2026, implemented on `fix/chat-hardening`. Commands (all with `env -u LLM_API_KEY`, `NODE_ENV=test` for the local-server tests):
  - `npm run check`: clean (tsc x4 plus the worker bundle guard).
  - `npx tsx --test test/assistant-no-dead-ends.test.ts`: 10 of 10 pass (warm and cold).
  - `npx tsx --test test/assistant-no-dead-ends.test.ts test/assistant-scope-controls.test.ts test/assistant-date-phrases.test.ts test/assistant-cold-journey.test.ts test/assistant-open-question.test.ts test/assistant-clarification-chips.test.ts`: 88 of 88 pass.
- Design: the fixed re-ask copy is `GUEST_ASSISTANT_COPY.openQuestion` (one sentence per closed code, in `guest-content.ts`). The runtime's scope-refusal branch now re-asks the held open question with its chips (`openQuestionQuickReplies`) when the verdict is unclear or failed and the risk is ordinary, and otherwise (no open question) offers the pack's stage recovery chips (`recoveryQuickReplies`); a scope redirect and a risk verdict keep the fixed copy with no chips. `controlOutcome` stays the turn's closed outcome (`scope_unavailable`, the failure outcome, or `scope_redirect`). `settlePendingGuestFacts` now runs only after an in-scope or mixed verdict and writes the candidate state only, so a refused turn leaves `pendingDate` intact and commits no check-in.
- ADRs read and applied: 0106 (fixed platform copy on refusal, no model text, closed telemetry outcomes, date authority needs a confirmed show-back, no keyword fast path), 0075 (no guest text echoed), 0077 (guest copy lives in `guest-content.ts`).
- Definition of Done: six acceptance criteria each have a dedicated named test in `assistant-no-dead-ends.test.ts`; ADRs listed; no unused injected dependency; no invented copy beyond the fixed closed-code sentences (the issue names the copy); no credential or identity material added; check and the tests above are green.
