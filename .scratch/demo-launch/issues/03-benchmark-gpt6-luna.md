# Benchmark GPT-6 Luna against the baseline

Status: ready-for-human
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
- [x] AC4: `docs/testing/openrouter-gpt6-luna-benchmark.md` exists with 3 live runs and a go/no-go verdict.
- [x] AC5: `npm run test:assistant` stays green.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0079 | Replay and evidence before a model upgrade | AC4 |
| 0075 | No content in logs or artifacts | AC3 |
| 0080 | Fabricated prices or bookings mean the model fails | AC4 verdict |

## Comments

### 23 October 2026: benchmark review findings 1 and 2 fixed

The owner authorized both review fixes. This change affects the smoke harness and report generator, rather than application behavior.

Finding 1:

- The grader now retains named authoritative price facts instead of one set of interchangeable amounts.
- It distinguishes nightly rates, accommodation, mandatory fees, deposits, stay totals, and amounts due.
- It rejects a fee presented as a stay total and rejects a stay total presented as a deposit or fee.
- NGN and naira suffixes are checked. Ambiguous monetary roles fail closed.
- Completed, secured, paid, and active booking/payment confirmation wording is checked.
- Negation and future-step tests remain green. Separate messages cannot share a negation.
- These are bounded language checks. They do not prove correctness for unrestricted prose or every currency representation.

Finding 2:

- The report generator requires exactly four distinct stages for each attempted journey.
- It checks stage names, journey bounds, verdict consistency, provider flags, budgets, requests, and performance counts.
- Missing, duplicate, unknown, contradictory, or malformed evidence is refused before rendering.
- Complete failed runs still render NO-GO. A complete single journey remains INCOMPLETE for the required three-journey benchmark.
- Each new result identifies its grading profile. Old or unsupported profiles cannot establish a new verdict.

ADR compliance table:

| ADR | Constraint | Affected code / verification |
| --- | --- | --- |
| 0015, 0089 | Preserve the meaning of authoritative price components. | Named price facts and cross-role regression tests. Accommodation comes from `detailQuote.lineItems.accommodationKobo`. |
| 0075 | Keep prompts, replies, and credentials out of artifacts. | Claims are checked in memory. Saved evidence contains classifications and numbers only. |
| 0079 | Require complete and consistent model evaluation evidence. | Stage matrices, count reconciliation, strict report validation, and grading-profile checks. |
| 0080 | False booking/payment confirmation cannot pass evaluation. | Confirmation variants, negation tests, and NO-GO preservation. |

Red-first evidence:

```text
npx tsx --test test/pilot-agent-smoke-grading.test.ts test/pilot-agent-smoke-report.test.ts
```

Before implementation: nine tests, four passed and five failed. These reproduced the review's price, status, and invalid-evidence examples.
Additional profile, accommodation subtotal, and accommodation-label regressions each failed before their corresponding change.

Final checks used `NODE_ENV=test` and `COMMERCE_REFERENCE_TEST_KEY=allow`:

```text
npm run check
npx tsx --test test/pilot-agent-smoke-grading.test.ts test/pilot-agent-smoke-report.test.ts test/pilot-agent-smoke-metrics.test.ts test/pilot-agent-smoke-reference.test.ts test/pilot-agent-smoke-budget.test.ts test/pilot-base-url.test.ts
```

- Type checking and the Worker bundle guard: exit 0.
- Focused tests: 34 of 34 passed, exit 0.
- Final `npx tsx --test test/pilot-agent-smoke-grading.test.ts test/pilot-agent-smoke-report.test.ts`: 13 of 13 passed, exit 0.
- Final `npm run check`: exit 0. Task credential scanning and `git diff --check` passed.
- Scripted reference: four of four stages passed, zero provider requests, exit 0.
- First stricter live run, profile v2: 11 of 12 stages passed; one inspection verification failed, exit 1.
- The v2 numeric trace included NGN 190,000. Its claim label was not retained, so the exact meaning cannot be verified retrospectively.
- NGN 190,000 equals the domain quote's accommodation subtotal. Profile v2 had no authoritative subtotal role.
- Profile v3 accepts that domain value only as accommodation or a subtotal. Presenting it as the full stay total still fails.
- Fresh v3 live run: three journeys, 12 of 12 stages passed, 24 provider requests, exit 0.
- Strict benchmark rendering: exit 0. The verdict explicitly applies to the evaluated local discovery-to-draft journey.
- Both live review runs used 48 requests. Key usage increased from USD 0.009090460 to USD 0.014437050.
- Current-run usage increase: USD 0.002565100. Current-run catalogue estimate: USD 0.004670800.
- Remaining key allowance: USD 1.985562950 under the USD 2 cap. No further paid calls followed the passing v3 run.

Live commands followed the temporary-directory pattern recorded below. The final run used `--scripted --runs 1`, then `--runs 3`.
Credentials came from the Windows user environment. Keys were never printed or written to task files.

Evidence:

- `docs/testing/openrouter-gpt6-luna-benchmark.md`: current v3 benchmark.
- `docs/testing/openrouter-gpt6-luna-benchmark-result.json`: current live evidence.
- `docs/testing/openrouter-gpt6-luna-scripted-reference-result.json`: current offline reference.
- `docs/testing/openrouter-gpt6-luna-pre-review.md` and its result: preserved earlier passing evidence with the weaker grader.
- `docs/testing/openrouter-gpt6-luna-role-check-v2-no-go-result.json`: preserved intermediate failure, unchanged.
- `.scratch/pilot-agent-smoke/2026-10-23-review-fixes/`: ignored local logs and bounded numeric probes.

Definition of Done self-review: named regression tests cover both findings and their failure paths; applicable ADRs are mapped above.
Helpers are used by the harness and tests. No service, dependency, business policy, application code, or deployment setting changed.
Credentials and model prose remain absent from artifacts. Type checking and the 34 affected tests passed.
The issue remains `ready-for-human`. Broader scenario coverage and staging/browser acceptance remain outstanding.
Full browser and Workers suites were not run because this change does not merge or deploy the batch.

### 23 October 2026: diagnosis fixed; three live journeys now pass

The owner requested diagnosis with the goal of making the concierge usable.
The diagnostic loop reproduced both failures in two additional one-journey runs before application changes.
The first diagnostic runner did not inherit the probe. The second used Node imports directly and recorded bounded facts.
Neither probe retained prompts, model replies, credentials, or HTTP headers.

Confirmed causes:

1. The model filled unknown search fields with zero bedrooms, one night, and one guest. Zero bedrooms excluded the available apartment.
2. `Number(null)` also converted unknown bedroom values into a studio filter. Null nights and guests became invalid zero values.
3. The model repeated the authoritative NGN 12,000 mandatory fee. The grader excluded this valid fee and falsely classified fabrication.
4. The inspection grader assumed two nights, while the invented search duration was one night.
5. After undated discovery, the detail tool could return no total while the surface displayed a dated demo quote.

Changes:

- Search schemas accept null for unknown nights, guests, and bedrooms. The prompt forbids invented zero or one defaults.
- Execution treats null as unknown and preserves prior constraints. Explicit zero-bedroom studio filters still work.
- The detail tool now projects the current Unit for the same dates used by its surface. It marks demo dates.
- Price grading accepts current authoritative fees and quote amounts. Unsupported prices and false confirmations still fail.
- The grader uses actual detail dates and the current booking quote. It also distinguishes simple negated booking claims.
- `--scripted` runs the same four-turn harness with fixed tool decisions and no credentials, network calls, or live performance claims.

ADR compliance:

| ADR | Constraint | Verification |
| --- | --- | --- |
| 0015, 0089 | Domain prices include mandatory fees; unknown stay details cannot become a firm quote. | Unknown discovery remains undated. Detail prices match the domain projection. Unsupported price tests remain red-capable. |
| 0068, 0069 | Provider adapters retain the neutral interface and pinned protocol. | No provider SDK, model default, or interaction protocol changed. |
| 0072, 0080 | Guest confirmation and platform commands retain transaction authority. | All three live booking turns created reviewable drafts without downstream transactions. |
| 0075 | Secrets and conversation content stay out of artifacts. | Probes record bounded facts only. Artifact checks found no credential value. |
| 0077, 0102 | Model and channel prices come from current application projections. | A regression test verifies detail-tool and surface quote context. |
| 0079 | Preserve failed evidence and rerun semantic checks after changes. | Initial NO-GO files remain alongside the passing benchmark. |
| 0092, 0105 | Production and demo stay limits remain distinct. Synthetic evaluation uses OpenRouter only. | Extended-stay assistant tests pass. No deployment or payment provider was called. |

Red-first evidence:

```text
npx tsx --test test/assistant-search-unknowns.test.ts
```

Before fixes: four tests, one passed and three failed. The failures covered null execution, schema support, and prior-filter preservation.

```text
npx tsx --test --test-name-pattern='Unit detail gives' test/assistant-search-unknowns.test.ts
```

Before the detail fix: one failed. The tool returned no total while the expected domain quote was NGN 370,000 in that fixture.
After the fixes, all seven new search and grading tests passed.
The scripted-reference integration test was added after implementation; this is a test-first deviation.

Final verification commands used `NODE_ENV=test` and `COMMERCE_REFERENCE_TEST_KEY=allow`:

```text
npm run check
npx tsx --test test/assistant-search-unknowns.test.ts test/pilot-agent-smoke-grading.test.ts test/pilot-agent-smoke-reference.test.ts test/pilot-agent-smoke-metrics.test.ts test/pilot-agent-smoke-budget.test.ts test/pilot-base-url.test.ts test/demo-extended-assistant.test.ts
npm run test:assistant
```

- Type checking and the Worker bundle guard: exit 0.
- Focused tests: 29 of 29 passed, exit 0.
- Assistant tests: 56 of 56 passed, exit 0.
- Scripted reference: four of four stages passed, zero provider requests, exit 0.
- Live rerun: three journeys, 12 of 12 stages passed, 24 provider requests, exit 0.
- Each live stage passed three of three. No fabrication, rendering, rate-limit, or request-budget failure was recorded.
- Median turn latency: 5,718 ms. The 95th percentile was 8,787 ms. These are complete-turn measurements.
- Passing-rerun catalogue estimate: USD 0.004607300. Reported key usage increased by USD 0.002634830.
- Cumulative key usage: USD 0.009090460. Remaining allowance under the USD 2 cap: USD 1.990909540.

The exact local-run pattern used fresh temporary pilot data, without replacing the existing pilot:

```powershell
Push-Location $benchmarkRoot
node C:\AI2026\chat-marketplace\node_modules\tsx\dist\cli.mjs C:\AI2026\chat-marketplace\apps\pilot\src\cli-local-bootstrap.ts
node --import file:///C:/AI2026/chat-marketplace/node_modules/tsx/dist/loader.mjs C:\AI2026\chat-marketplace\scripts\pilot-agent-smoke.ts --scripted --runs 1
# Preserve the reference result before the live run. Load LLM_API_KEY from the Windows user environment without displaying it.
$env:CONCIERGE_MODE = 'openai-compatible'
$env:LLM_PROVIDER_LABEL = 'openrouter'
$env:LLM_BASE_URL = 'https://openrouter.ai/api/v1'
$env:LLM_MODEL = 'openai/gpt-6-luna'
node --import file:///C:/AI2026/chat-marketplace/node_modules/tsx/dist/loader.mjs --import file:///C:/AI2026/chat-marketplace/.scratch/pilot-agent-smoke/diagnosis/trace.mjs C:\AI2026\chat-marketplace\scripts\pilot-agent-smoke.ts --runs 3
Pop-Location
npx tsx scripts/pilot-agent-smoke.ts --write-benchmark-doc
```

The probe is an ignored diagnostic artifact. Normal smoke runs do not import it.
Evidence lives in `docs/testing/openrouter-gpt6-luna-benchmark.md`, its numeric result, the preserved initial NO-GO files, and the scripted-reference result.
The ignored archive `.scratch/pilot-agent-smoke/2026-10-23-issue03-fixed/` contains verification logs and numeric probe output.

Definition of Done self-review:

1. Original AC tests remain present. New regression tests cover unknown fields, prior filters, studio filters, detail prices, grading, and the reference.
2. Unknown-value failures and unsupported price/confirmation paths are covered. The reference test forbids network access with synthetic keys configured.
3. Applicable ADRs were listed and read. The table above maps their constraints to changes and evidence.
4. The reference and grader helpers are exercised by the smoke script and tests. No unused dependency was added.
5. No business policy, service, dependency, provider default, or deployment configuration changed.
6. Task artifacts contain no credentials or conversation prose. Source fixtures contain synthetic strings only.
7. Type checking, all 29 focused tests, and all 56 assistant tests passed. The full suites remain the batch deployment gate.

Final text-only report changes were followed by another `npm run check`: exit 0.
`npx tsx --test test/pilot-agent-smoke-metrics.test.ts test/pilot-agent-smoke-reference.test.ts` then passed eight of eight, exit 0.
Artifact checks confirmed 12 live passes, a non-live offline result, and no credential values. `git diff --check` passed.

The issue is `ready-for-human` for benchmark acceptance. The narrow four-turn local evaluation passes; staging and full-browser acceptance remain separate.
No production-readiness claim, deployment, push, or real payment is implied.

### 23 October 2026: three live journeys completed; NO-GO

The owner supplied `LLM_API_KEY` through the Windows user environment. No credential was written to repository files or logs.
OpenRouter key inspection reported a USD 2 limit, USD 2 remaining, and zero prior usage before paid calls.
The public catalogue confirmed `openai/gpt-6-luna`, with USD 0.0000001 per prompt token and USD 0.0000005 per completion token.

ADR review: 0075 governs redacted artifacts; 0079 governs evaluation evidence; 0080 preserves platform authority; 0105 limits the demo processor and synthetic scope.
The live result retains no model prose, prompt text, or credential. All booking turns preserved guest review and created no downstream transaction.

The existing local pilot dated from September. A new temporary directory held a separately bootstrapped synthetic pilot.
The original pilot and unrelated working-tree changes were preserved. Source HEAD was `9a22b36`; this was not a clean-checkout gate.

Commands and results:

```powershell
# $benchmarkRoot identifies the new temporary directory. It contains synthetic data only.
# $env:LLM_API_KEY was loaded from the Windows user environment without displaying it.
$env:NODE_ENV = 'test'
$env:COMMERCE_REFERENCE_TEST_KEY = 'allow'
npm run check
npx tsx --test test/pilot-agent-smoke-metrics.test.ts test/pilot-agent-smoke-budget.test.ts test/pilot-base-url.test.ts
npm run test:assistant

Push-Location $benchmarkRoot
node C:\AI2026\chat-marketplace\node_modules\tsx\dist\cli.mjs C:\AI2026\chat-marketplace\apps\pilot\src\cli-local-bootstrap.ts
$env:LLM_API_KEY = [Environment]::GetEnvironmentVariable('LLM_API_KEY', 'User')
$env:CONCIERGE_MODE = 'openai-compatible'
$env:LLM_PROVIDER_LABEL = 'openrouter'
$env:LLM_BASE_URL = 'https://openrouter.ai/api/v1'
$env:LLM_MODEL = 'openai/gpt-6-luna'
node C:\AI2026\chat-marketplace\node_modules\tsx\dist\cli.mjs C:\AI2026\chat-marketplace\scripts\pilot-agent-smoke.ts --runs 3
Pop-Location
# Copy the redacted live artifacts into .scratch/pilot-agent-smoke before rendering.
npx tsx scripts/pilot-agent-smoke.ts --write-benchmark-doc
```

- Type checking: exit 0, including all configured TypeScript projects and the Worker bundle guard.
- Focused benchmark tests: 20 of 20 passed, exit 0.
- Offline assistant tests: 56 of 56 passed, exit 0.
- Synthetic bootstrap: exit 0.
- Live smoke: three journeys, 12 turns, 24 requests; exit 1.
- Discovery: 0 of 3 passed. Refinement: 3 of 3 passed.
- Unit inspection: 0 of 3 passed. Booking intent: 3 of 3 passed.
- Failures: `MODEL_SELECTION_FAILURE` 3; `FABRICATION_FAILURE` 3.
- All 12 surface rendering checks passed. No rate limit or request-budget exhaustion occurred.
- Benchmark rendering: exit 0. The generated verdict is NO-GO.
- Catalogue-price estimate: USD 0.004815900. Key usage increased by USD 0.003851435.
- Remaining key allowance: USD 1.996148565. No additional paid retries were run.

Evidence: `docs/testing/openrouter-gpt6-luna-benchmark.md` and `docs/testing/openrouter-gpt6-luna-benchmark-result.json`.
The ignored archive `.scratch/pilot-agent-smoke/2026-10-23-issue03/` holds run artifacts, previous reports, and local check logs.

AC4 is complete with a negative verdict. The issue remains open; issues 06 and 07 remain blocked on benchmark acceptance.
Next work: diagnose empty discovery results and inspection flags without discarding this failed run.
The report lacks model prose and search arguments, so it cannot prove the exact cause.
The fabrication detector matches booking words without checking negation. Review this possible grading limitation before concluding model fabrication.
The separate four-turn scripted reference remains unfinished. The 56 offline tests do not replace it.
No implementation changed, no commit was made, and no deployment or push occurred.
The full batch suites were not run; this task did not merge or deploy code.

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
