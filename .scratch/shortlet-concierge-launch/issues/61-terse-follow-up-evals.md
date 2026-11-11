# Evals for terse follow-ups (offline cases plus owner-run live cases)

Status: claimed
Type: AFK (the live run is owner-run)
Blocked by: 57, 58, 59
Requested: 9 Nov 2026

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md). Batch: chat hardening, issues 56–62.

## Why

Every offline test scripts the classifier verdict (`scriptedPlanner` in `test/helpers/guest-date-fixtures.ts`), so none of them catches a live model reading "Just me" as `unclear`. ADR 0106 (L68) asks for false refusals to be measured separately. After issue 57 the classifier and planner receive the open question. These cases pin the offline wiring, and they give the owner a live check of the false-refusal rate.

## What to build

1. **Offline.** Add `test/assistant-terse-followups.test.ts`: assistant on, cold restore before every event, 2026-10-27 clock, staging guest. For each case, set up the open question, send the text, and assert two things:
   - the classifier request carries the expected `openQuestion`;
   - with a scripted in-scope verdict carrying the slot, the fact is committed and the next step follows (a search, a detail, or a confirmed date).

   | Open question | Guest text | Expected fact |
   |---|---|---|
   | party_size | "just me" / "2" / "two of us" / "me and my wife" | partySize 1 / 2 / 2 / 2 |
   | nights | "a week" / "3" | nights 7 / 3 |
   | pick_result | "the first one" / "the second" | opens result 1 / 2 |
   | date_confirm | "yes" | check-in confirmed |
   | where | "Wuse 2" | Abuja, Wuse 2 |

2. **Live.** Add the same cases to the existing live eval (`scripts/pilot-agent-smoke.ts`, with its report in `scripts/pilot-agent-smoke-report.ts`). Report the per-case verdict and the false-refusal rate as closed codes only, with no model text (ADR 0075). Agents write the cases and must never run the live eval: it needs `LLM_API_KEY`. The owner runs it and records the result here.
3. Add the cases to `docs/testing/shortlet-assistant-v1.md`.

## ADRs

| ADR | Constraint | Where |
|---|---|---|
| 0106 | False refusals are evaluated separately. Diagnostics use closed codes. No fast path. | Steps 1–2 |
| 0075 | No model text in reports. | Step 2 |

## Acceptance criteria

- [x] Each offline case asserts the open-question code on the classifier request and the committed fact.
- [x] A case with an `unclear` verdict falls back to the issue 59 re-ask, not to `unavailable`.
- [x] The live eval lists the cases and reports a false-refusal rate. It is checked offline only with a fake model client.
- [ ] Owner: the live run is recorded in Comments with its rate. Target: no false refusals across the cases on `openai/gpt-6-luna`.

## Verification

`npm run check`; `env -u LLM_API_KEY npx tsx --test test/assistant-terse-followups.test.ts test/assistant-open-question.test.ts`. Record the counts in Comments.

## Comments

- 2026-11-11 20:17, owner live run (`npm run pilot:local:agent-smoke -- --request-limit 16`, OpenRouter `openai/gpt-6-luna`, f836c5d): journey PASS (4/4 tasks, 0 guard failures, 13 model calls). Terse suite: run, 18 of 40 requests used, false-refusal rate 0.250 (2 of 8 cases with a verdict), 2 failed cases, so not valid for acceptance.
  - `pick_result:first`, `pick_result:second`: scope `unclear`, reason `unclear`, code sent `pick_result`, FAIL (false refusals).
  - `party_size:couple`: scope failed, reason failed, code sent `party_size`, FAIL (no verdict read).
  - `nights:week`: scope failed, reason failed, code sent none, FAIL (no verdict read).
  - Passed: `party_size:solo`, `party_size:numeral`, `party_size:pair`, `nights:numeral`, `date_confirm:affirm`, `where:area`.
- Offline fix batch on `fix/terse-followups` (the issue stays claimed until a new live run passes; the owner reruns with `-- --request-limit 16`):
  - `nights:week` was a measurement defect, not a missing open question: a cold-restore trace shows the classifier is the first model call and its request carries `openQuestion: nights`. A classifier attempt that gives up before its response lands was reported as "code sent none"; the report now records the closed `no_response` failure and the turn's closed control outcome, and scores the case from that outcome (never as a false refusal).
  - `party_size:couple` now reports the closed parse-failure code (`not_json`, `scope_missing`, `scope_invalid`, `reason_missing`, `reason_invalid`, `tool_calls`, `text_missing`), with no model text. The classifier instruction now states the scope-to-reason mapping the parser enforces.
  - `pick_result:*`: the classifier context now carries a closed result count, and the instruction states that a positional reply to `pick_result` answers it. The eval seeds a shown result list (count only) for these cases.
  - The default 10-request limit is unchanged; the live command in `docs/testing/shortlet-assistant-v1.md` passes `--request-limit 16` because the 4-step journey needs about 12 calls.

- 9 Nov 2026, offline cases landed on `fix/chat-hardening` (issue NOT yet resolved: the full case table offline and the live eval remain). Commands (all with `env -u LLM_API_KEY`, `NODE_ENV=test`):
  - `npm run check`: clean.
  - `npx tsx --test test/assistant-terse-followups.test.ts test/assistant-open-question.test.ts`: 22 of 22 pass (warm and cold).
- Done: `test/assistant-terse-followups.test.ts` covers the party-size family ("just me"/"2"/"two of us"/"me and my wife" → partySize 1/2/2/2), the `where` answer ("Wuse 2" → Abuja, Wuse 2), and the `unclear`-to-issue-59-re-ask fallback; each asserts the classifier request's `openQuestion` code and the committed fact. The case table is added to `docs/testing/shortlet-assistant-v1.md`.
- Remaining before resolution: offline cases for `nights`, `pick_result` and `date_confirm` (the table rows not yet in the test); the live eval cases in `scripts/pilot-agent-smoke.ts` with a per-case closed-code report and a false-refusal rate (checked offline with a fake model client); and the owner's live run recorded here. Agents must never run the live eval (it needs `LLM_API_KEY`).
- ADRs read and applied: 0106 (false refusals evaluated separately; diagnostics use closed codes; no fast path), 0075 (no model text in reports).

- 9 Nov 2026, remaining work finished (issue stays `claimed`: only the owner's live run remains). Commands (all with `env -u LLM_API_KEY`, `NODE_ENV=test`):
  - `npm run check`: clean (tsc x4 plus the worker bundle guard).
  - `npx tsx --test test/assistant-terse-followups.test.ts test/assistant-open-question.test.ts test/assistant-no-dead-ends.test.ts test/pilot-agent-smoke-report.test.ts test/pilot-agent-smoke-grading.test.ts test/pilot-agent-smoke-metrics.test.ts test/pilot-agent-smoke-budget.test.ts test/pilot-agent-smoke-reference.test.ts`: 87 of 87 pass.
- Offline rows added to `test/assistant-terse-followups.test.ts`, warm and cold, each asserting the classifier request's `openQuestion` and the committed fact/next step: `nights` ("a week" → 7, "3" → 3; a confirmed check-in with no nights is set up via the runtime's own stay setters for warm and the durable projection for cold, because the chip path always records nights with the check-in), `pick_result` ("the first one"/"the second" open result 1/2 via the deterministic which-one path), and `date_confirm` ("yes" confirms a single-candidate "tomorrow" show-back). Confirmed these fail if `openQuestion` is removed from the classifier context (temporarily removed the context field: 9 of 11 failed, then restored).
- Live eval: `scripts/pilot-agent-smoke-terse.ts` holds the case table (party_size ×4, nights ×2, pick_result ×2, date_confirm ×1, where ×1) and `evaluateTerseFollowUps`; `scripts/pilot-agent-smoke.ts` runs it after the journeys and `scripts/pilot-agent-smoke-report.ts` renders per-case closed codes (scope, reasonCode, the code sent, pass/fail) and the false-refusal rate. Case ids are neutral labels, so the report carries no guest or model text (ADR 0075). Offline checks added to `test/pilot-agent-smoke-report.test.ts` with a fake model client: all-answer → rate 0; one refusal → 1/10; the rendered report has no guest text.
- Docs: `docs/testing/shortlet-assistant-v1.md` lists every row and the owner live-run command.
- Owner acceptance criterion left unticked. Live command (owner only; `LLM_API_KEY` set for this command only, every other command uses `env -u LLM_API_KEY`; the key is owner-supplied and never printed):
  `CONCIERGE_MODE=openai-compatible LLM_BASE_URL=https://openrouter.ai/api/v1 LLM_MODEL=openai/gpt-6-luna LLM_PROVIDER_LABEL=openrouter LLM_API_KEY=… npm run pilot:local:agent-smoke`
  Then record the false-refusal rate here. Target: no false refusals across the cases on `openai/gpt-6-luna`.
- ADRs: 0106 (false refusals measured separately; closed codes; no keyword fast path; date authority unchanged), 0075 (no model or guest text in reports).

- 9 Nov 2026, blocker fix and review follow-ups (issue stays `claimed`: only the owner's live run remains).
- Blocker fixed: the terse suite now runs through the guarded provider path, not the raw provider client. `scripts/pilot-agent-smoke.ts` wraps each case in its own active provider turn (both the module turn and the request context), so `reserveProviderRequest` and `noteTransportStart` account for it; a second, named budget (`TERSE_REQUESTS_PER_CASE = 4`, `TERSE_REQUEST_BUDGET = 40`) is recorded in the report (`requestBudget`/`requestsUsed`), and the suite is skipped with a closed reason (`rate_limited` | `request_budget_exceeded` | `terse_budget_exceeded`) after a rate-limit or budget stop. The report gained `status`, `skipReason` and the budget fields.
- Offline test that would have caught the blocker: `test/pilot-agent-smoke-report.test.ts` drives the suite through an `AsyncLocalStorage` guard with a fake that throws outside an active turn. Through the wrapper every case reaches the classifier; without the wrapper every case is `failed`. A second test asserts the suite is `skipped` with `rate_limited`.
- `date_confirm` now asserts the exact committed check-in, `2026-10-28` (the clock is 2026-10-27 Africa/Lagos and the show-back is "tomorrow"), not `typeof string`.
- pick_result note: "the first one" / "the second" commit through the shell's provider-down fallback (`#viewResultFromChat`), so those rows prove the classifier `openQuestion` code and that the deterministic fallback opens result N — not that the planner opens a result.
- Scripted status: the full `scripts/pilot-agent-smoke.ts --scripted` fails earlier at local-pilot environment setup in this worktree (pre-existing; `journeysAttempted: 0`), so it did not emit the terse section. The scripted terse eval was exercised directly and reported `status run`, request budget 40 used 0, false-refusal rate 0.000, 10 of 10 PASS.
- Commands (all with `env -u LLM_API_KEY`, `NODE_ENV=test`): `npm run check`: clean. `npx tsx --test test/assistant-terse-followups.test.ts test/assistant-open-question.test.ts test/assistant-no-dead-ends.test.ts test/pilot-agent-smoke-report.test.ts test/pilot-agent-smoke-grading.test.ts test/pilot-agent-smoke-metrics.test.ts test/pilot-agent-smoke-budget.test.ts test/pilot-agent-smoke-reference.test.ts`: 89 of 89 pass.
- Owner acceptance criterion remains unticked, with the live command above.

- 9 Nov 2026, false-refusal denominator and provider-stop follow-up (before the issue 61 commit):
  - The false-refusal rate now divides by the cases that returned a verdict (scope not `failed`); the report shows `Failed cases: N` and `Valid for acceptance: yes/no` (a failed case, or a skipped suite, makes the run not valid for acceptance).
  - A provider rate limit or failure inside the suite stops it with a closed skip reason (`rate_limited` / `provider_failure`, via `providerStopReason`), instead of spending the remaining budget; the suite's own budget stop maps to `terse_budget_exceeded`.
  - Offline tests added: one fake returns invalid JSON for a case (failedCases 1, rate 1 of the 9 with a verdict, rendered "Failed cases: 1" / "Valid for acceptance: no"); one fake throws a provider 429 (status skipped, reason `rate_limited`); the unguarded guard test now asserts `skipped` / `provider_failure`.
  - Commands (all with `env -u LLM_API_KEY`, `NODE_ENV=test`): `npm run check`: clean. The 8-file list (`test/assistant-terse-followups.test.ts test/assistant-open-question.test.ts test/assistant-no-dead-ends.test.ts test/pilot-agent-smoke-report.test.ts test/pilot-agent-smoke-grading.test.ts test/pilot-agent-smoke-metrics.test.ts test/pilot-agent-smoke-budget.test.ts test/pilot-agent-smoke-reference.test.ts`): 91 of 91 pass.
