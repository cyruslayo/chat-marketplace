# Benchmark GPT-6 Luna against the baseline

Status: needs-info
Type: AFK
Blocked by: 02
Requested: 21 Oct 2026

## Parent

[Public Live Demo Launch PRD](../PRD.md)

## Why

The owner wants the agent's performance measured before the demo. ADR 0079 also requires smoke and eval evidence before a model-runtime change.

- `scripts/pilot-agent-smoke.ts` (`npm run pilot:local:agent-smoke`, `--runs 1-3`) drives `AssistantRuntime` against a real provider. Its 4-turn journey covers discovery, refinement, unit inspection and booking intent.
- Each turn is graded on tool choice, entity and price accuracy, Weaver renderability and fabrication. Results go to `.scratch/pilot-agent-smoke/agent-smoke-result.json` and `agent-smoke-report.md`.
- It records **no latency, token counts or cost**.
- The per-journey request budget is `DEFAULT_PROVIDER_REQUEST_BUDGET_PER_JOURNEY=10` (`scripts/pilot-agent-smoke-budget.ts`).
- `npm run test:assistant` runs the offline evals (`test/shortlet-assistant-evals.test.ts`) against `ScriptedAssistantModel`.

## What to build

- Extend `pilot-agent-smoke.ts` to record per turn and per journey:
  - wall-clock latency, aggregated as p50 and p95;
  - model calls per turn;
  - prompt and completion tokens, from the `usage` field added in issue 02;
  - estimated cost, from the per-token price that the OpenRouter models endpoint reports for the slug. Read the price at run time, not from a hardcoded constant.
- Make the extra fields optional in the result JSON, so Gemini and other providers without `usage` still produce a report.
- Run 3 journeys against GPT-6 Luna. As a reference point, also run the scripted offline model, which gives tool-choice correctness without latency.
- Write `docs/testing/openrouter-gpt6-luna-benchmark.md` with:
  - the date, slug and run count;
  - a table of pass rate per grading dimension, p50/p95 latency, tokens per journey and cost per journey;
  - failures by `AssistantFailureClass`;
  - a go/no-go line for the demo.
- If any journey fabricates a price or a "booked" claim, record it as **no-go** and comment on the issue. Do not tune it away silently.

## Acceptance criteria

- [x] AC1: The smoke result JSON includes per-turn latency, model-call count and token usage when the provider returns `usage`.
- [x] AC1 failure path: when the provider returns no `usage`, the report still writes, and the token and cost fields are marked unavailable instead of zero.
- [x] AC2: The cost estimate comes from the OpenRouter-reported price for the model slug. A unit test covers the arithmetic.
- [x] AC3: No prompt, reply or key text is written to the result or report files (ADR 0075). A test asserts this on a stubbed run.
- [ ] AC4: `docs/testing/openrouter-gpt6-luna-benchmark.md` exists with 3 live runs and a go/no-go verdict.
- [x] AC5: `npm run test:assistant` stays green.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0079 | Replay and evidence before a model upgrade | AC4 |
| 0075 | No content in logs or artifacts | AC3 |
| 0080 | Fabricated prices or bookings mean the model fails | AC4 verdict |

## Comments

- 22 Oct 2026: The benchmark needs an owner-supplied OpenRouter credential for three live runs. No credential is available in this environment. Do not record or request the credential in repository files or logs. Resume when the owner supplies it through the approved secret store or environment.
- 22 Oct 2026 (offline executor, commit fc3df55): AC1, AC1 failure path, AC2, AC3 and AC5 are implemented and ticked. AC4 stays open and the status stays `needs-info`. No provider was called.

  ADR table (ADRs in `docs/adr/` listed; 0075, 0079, 0080 and 0105 read in full; the others do not touch this path):

  | ADR | Constraint | Code path / criterion |
  | --- | --- | --- |
  | 0075 | No prompt, reply or key text in result or report | `scripts/pilot-agent-smoke-report.ts` writes only numbers, statuses and diagnostic summaries; AC3 test |
  | 0079 | Observable, replayable evidence before a model change | `observeModelClient` and per-turn timing in `pilot-agent-smoke.ts`; AC1 tests |
  | 0080 | A fabricated price or booking claim is a no-go | `renderBenchmarkDocument` verdict: any `FABRICATION_FAILURE` gives NO-GO |
  | 0105 | OpenRouter is the demo processor for GPT-6 Luna only | Price read is the public models catalogue, no credential sent; smoke stays in-process |

  Red first: `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/pilot-agent-smoke-metrics.test.ts` failed before implementation with `ERR_MODULE_NOT_FOUND` for `scripts/pilot-agent-smoke-metrics.js`. After implementation one expectation was corrected (two-sample nearest-rank p50 is 800, not 1200), then 7 of 7 passed.

  Commands and counts (all with `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow`):
  - `npm run check`: exit 0.
  - `npx tsx --test test/pilot-agent-smoke-metrics.test.ts test/pilot-agent-smoke-budget.test.ts`: 12 of 12.
  - `npx tsx --test test/pilot-base-url.test.ts` (affected: guards the smoke script's base-URL refusal): 8 of 8.
  - `npm run test:assistant` (AC5): 56 of 56.
  - Offline no-provider run, credentials removed from the environment: `env -u GEMINI_API_KEY -u LLM_API_KEY -u CONCIERGE_MODE npx tsx scripts/pilot-agent-smoke.ts` wrote a `NOT_RUN` result with `liveRun: false` and no `performance` block, exit 0.
  - `npx tsx scripts/pilot-agent-smoke.ts --write-benchmark-doc` with no live result: refused (`result is not a live run`), exit 2, no document written.
  - Not run per scope: `npm test` and `npm run test:workers` (pre-merge gate only).

  Definition of Done: (1) each AC has a named test, with the grouping noted above; (2) failure paths covered by the AC1, AC2 and AC4-guard tests; (3) ADRs above; (4) injected `fetch` and the model-call recorder are both called; (5) the only new constants are `REQUIRED_LIVE_JOURNEYS = 3` (issue AC4), the OpenRouter models URL (ADR 0105 provider, issue spec) and a 10-second price-fetch timeout, which is an engineering limit and not a domain policy; (6) no credential is logged or written; (7) recorded above. Not resolved, because AC4 is open.

  Deviations and risks:
  - AC3's "stubbed run" is tested through the observing model wrapper and the report writer with synthetic markers, not through a full `AssistantRuntime` journey (no provider or fixture is available offline).
  - The scripted offline reference run is not implemented. The script only has the no-provider `NOT_RUN` path. A scripted four-turn journey needs an owner decision on which fixtures to reuse.
  - The result field `totalGeminiProviderRequests` is renamed to `totalProviderRequests`, since it counts OpenRouter calls too.
  - Gemini has no OpenRouter slug, so its cost is always unavailable (by design).

  Owner command for AC4 (run only after the key is supplied through the approved secret store; the script reads `LLM_API_KEY`, not `OPENROUTER_API_KEY`; `<key>` is a placeholder, never write the value):
  ```
  CONCIERGE_MODE=openai-compatible LLM_PROVIDER_LABEL=openrouter LLM_BASE_URL=https://openrouter.ai/api/v1 LLM_MODEL=openai/gpt-6-luna LLM_API_KEY=<key from secret store> npm run pilot:local:agent-smoke -- --runs 3
  npx tsx scripts/pilot-agent-smoke.ts --write-benchmark-doc
  ```
  Then review `docs/testing/openrouter-gpt6-luna-benchmark.md` for the go/no-go line, tick AC4 only after that review, and record the live commands and counts here. The local pilot readiness check (`assertLocalPilotReady`) must pass first.
