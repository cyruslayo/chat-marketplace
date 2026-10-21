# Benchmark GPT-6 Luna against the baseline

Status: ready-for-agent
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

- [ ] AC1: The smoke result JSON includes per-turn latency, model-call count and token usage when the provider returns `usage`.
- [ ] AC1 failure path: when the provider returns no `usage`, the report still writes, and the token and cost fields are marked unavailable instead of zero.
- [ ] AC2: The cost estimate comes from the OpenRouter-reported price for the model slug. A unit test covers the arithmetic.
- [ ] AC3: No prompt, reply or key text is written to the result or report files (ADR 0075). A test asserts this on a stubbed run.
- [ ] AC4: `docs/testing/openrouter-gpt6-luna-benchmark.md` exists with 3 live runs and a go/no-go verdict.
- [ ] AC5: `npm run test:assistant` stays green.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0079 | Replay and evidence before a model upgrade | AC4 |
| 0075 | No content in logs or artifacts | AC3 |
| 0080 | Fabricated prices or bookings mean the model fails | AC4 verdict |

## Comments
