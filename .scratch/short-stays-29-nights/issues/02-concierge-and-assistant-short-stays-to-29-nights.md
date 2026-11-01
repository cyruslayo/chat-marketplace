# 02 · Concierge and assistant accept 1 to 29 nights

Status: resolved
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

### 1 Nov 2026: implementation (agent, branch feat/short-stay-and-extended-production)

**Files changed**
- `apps/local-guest/src/assistant/shortlet-assistant-pack.ts`: every stay-length 14 replaced by `MAX_STAY_NIGHTS` (imported from the domain). Schema maxima (`search_stays`, `prepare_request_draft`) are `MAX_STAY_NIGHTS`; `stayToolDefinitions` defaults to `MAX_STAY_NIGHTS` and widens to `policy.maximumNights` only when a policy is present. The two argument checks now throw `AssistantStayDetailsError` (a `tool_denial`) instead of a plain `RangeError` (which became `CONCIERGE_UNAVAILABLE`).
- `apps/local-guest/src/concierge.ts`: the comment now reads ADR-0023 as amended (1 to 29 nights). The refusal wording is changed only for a contiguous policy (see the wording note).
- `apps/local-guest/src/shortlet-app.ts`: comment only (`// The 29-night Short Stay and 90-day refusals ...`, was "14-night").
- `test/assistant-short-stays-29-nights.test.ts` (new): one named test per AC (AC1 twice, AC2 three, AC3 two, AC4 one, AC5 one).
- `test/helpers/guest-date-fixtures.ts`: optional `composition` on `datedFixture` (demo and deployment), so production-composition tests reuse the helper.
- `test/demo-extended-assistant.test.ts` (AC5): 15 and 29 nights now create a discovery surface; 181 nights is still refused.

**14-literal hits (`grep -rn "\b14\b" apps/local-guest/src apps/web-agent/src | grep -i night`, plus a broader pass for `> 14`, `maximum: 14`, `fourteen`)**
- `shortlet-assistant-pack.ts` :67 and :167 (schema maxima): fixed.
- `shortlet-assistant-pack.ts` :199 and :201 (`stayToolDefinitions`): fixed.
- `shortlet-assistant-pack.ts` :418 and :757 (argument checks): fixed.
- `concierge.ts` :612 (comment) and :616 (refusal): fixed as above.
- `shortlet-app.ts` :4515 (comment): updated.
- `apps/local-guest/src/landing-copy.ts` :12 (`LAUNCH_MAX_STAY_NIGHTS = 14`), :45 (example chip `nights: 14`), :232 (chip validation "1 to 14"): NOT touched, issue 03 owns it.
- `apps/web-agent/src`: no stay-length 14.
- Non-stay 14s (checkout hour pattern `14:00`, IDs) are not limits and were left alone.

**Wording note (for the owner to revise; not final copy)**
- With a contiguous policy (minimumNights = 30 = MAX_STAY_NIGHTS + 1), the refusal reuses the existing no-policy sentence with the policy maximum: `Stays can be at most 180 nights. Please choose 180 nights or fewer.`
- A non-contiguous policy keeps the existing "This demo supports stays up to 29 nights, or ..." sentence. No new wording was invented.
- Test copy that depends on this: `guest-criteria-strip.test.ts` AC3 now expects the 180-night sentence.

**ADR table (step 2 and 4)**

| ADR | Constraint | Code path |
|---|---|---|
| 0023 (amended 1 Nov) | Short Stay 1 to 29 nights | Schema maxima, `stayToolDefinitions` default, argument checks, `dateLimitRefusal` (concierge.ts) |
| 0092 (amended 1 Nov) | Extended Stay 30 to 180, policy only | `stayToolDefinitions` widening; `isExtendedStayLength` in the checks; the contiguous refusal wording |
| 0106 | Out-of-range planner call is `tool_denial`, never a thrown error; cold restore before every event; no keyword fast path | Argument checks throw `AssistantStayDetailsError`; the new tests use a cold restore before each event |
| 0093 | Chip nights are structured guest input, recorded with the confirmed check-in | `recordGuestStay` (unchanged): AC4 reads the durable `assistantContext` |
| 0055 | Horizon limits check-in only | Unchanged; the 21-night and 25-night checkouts are inside it |

**Deviations from the brief (please check)**
1. **AC1 text.** The guest message is "Ikoyi for 21 nights, 2 guests from 14 December 2026". Without a guest-authored date the planner's `checkIn` has no authority (ADR 0106 date rule), so the date is part of the message. The journey then runs search, View, Request to Book, with a cold restore before each event.
2. **AC1 "as a Short Stay".** The test asserts the 21-night Request Draft (its text names 21 nights and a `:request:draft:` surface). It does not inspect the Stay Quote's stay-type field directly.
3. **AC3 asserts the rejection at tool execution, not the turn outcome.** The schema violation is rejected at the runtime gate (`tool_execution`, `failureClass: MODEL_SELECTION_FAILURE`, `toolName: search_stays`, no success). The turn's `assistantControlOutcome` then reads `rejected_plan_fallback`, because the planner's next prose reply is rejected and the existing reply path overwrites the earlier `tool_denial` (`assistant-runtime.ts`, around the reply-plan branch). I did not change that runtime behaviour. If the owner wants the turn outcome to stay `tool_denial`, that is a runtime change to decide separately.
4. **AC4 reads the durable projection.** `thread.assistantContext` is asserted on the stored `threadJson` (as `assistant-persistent-continuity.test.ts` does). The `getState()` snapshot's `assistantContext` was `undefined` even after a normal search turn while the stored JSON held it. I did not change that snapshot; it is an observation for later.

**Existing tests updated because they encoded the old limit** (each change is in the file, not a removed check)
- `guest-criteria-strip.test.ts` AC3: example 30 to 181 nights (30 is an Extended Stay under the policy issue 05 added, so the old edit no longer refuses); expected sentence now the 180-night one. This was already failing at HEAD after issue 05.
- `assistant-tool-argument-validation.test.ts`: out-of-range example 99 to 181 nights (99 is valid under the 180 policy).
- `assistant-tool-authorization.test.ts`: `maximum-range` example 30 to 181 nights.
- `demo-extended-assistant.test.ts` AC5: loop split; 15 and 29 succeed, 181 refused.

**Not run (by rule or owned elsewhere)**
- `test/guest-criteria-strip-chromium.test.ts:80` (real browser, not run per the brief) still expects "Stays can be at most 14 nights". It will need the same update in the pre-merge browser run.
- `test/landing-page.test.ts:1512` (issue 03 owns it) not run here.
- `npm test` and `npm run test:workers` run once per batch, not per issue (Test scope).

**Commands and counts**
- `env -u LLM_API_KEY npx tsx --test test/assistant-short-stays-29-nights.test.ts`: 9 pass, 0 fail (after the implementation; before it, AC1, AC2 (no-policy), AC3, AC4, AC5 failed on the 14 literal, as expected).
- `env -u LLM_API_KEY npx tsx --test test/demo-extended-assistant.test.ts`: 1 pass, 0 fail.
- First run of the affected set (23 files, 242 tests): 239 pass, 3 fail. The three were the out-of-range examples above (argument-validation, authorization, criteria-strip AC3), updated as described.
- Final run of the affected set, `env -u LLM_API_KEY npx tsx --test test/assistant-short-stays-29-nights.test.ts test/demo-extended-assistant.test.ts test/assistant-cold-journey.test.ts test/assistant-tool-authorization.test.ts test/assistant-tool-argument-validation.test.ts test/guest-criteria-strip.test.ts test/assistant-date-literals.test.ts test/shortlet-assistant-evals.test.ts test/gemini-concierge.test.ts test/demo-openrouter.test.ts test/short-stay-29-nights.test.ts test/assistant-artifact-authority.test.ts test/assistant-pending-action-restore.test.ts test/assistant-proposal-replacement.test.ts test/assistant-proposal-supersession.test.ts test/assistant-turn-stop-cold-restore.test.ts test/assistant-where-chip.test.ts test/demo-extended-cancellation-notice.test.ts test/demo-extended-stay-180.test.ts test/demo-seed-trust-expiry.test.ts test/back-office-reservation.test.ts test/conditional-offer-token-restore.test.ts`: 242 pass, 0 fail, 0 cancelled, 0 skipped.
- `env -u LLM_API_KEY npm run check`: exit 0, clean (worker-bundle guard included).

**ADRs applied:** 0023 (amended), 0092 (amended), 0093, 0055, 0106. **Nothing unfinished in the ACs.** Browser suites and the batch-wide gates are left for the pre-merge run.
