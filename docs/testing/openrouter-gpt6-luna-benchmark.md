# OpenRouter GPT-6 Luna benchmark

- Date: 2026-10-23
- Provider: openrouter
- Model slug: openai/gpt-6-luna
- Live journeys: 3 of 3 configured (3 required for the benchmark)
- Offline reference: run separately with --scripted; see issue 03 Comments for its result

## Pass rate per grading dimension

| Dimension | Pass |
|---|---|
| discovery | 3 / 3 |
| refinement | 3 / 3 |
| unit inspection | 3 / 3 |
| booking intent | 3 / 3 |

## Latency (ms)

| Measure | p50 | p95 |
|---|---|---|
| Turn | 5718 | 8787 |
| Journey | 22769 | 28379 |

## Per journey

| Journey | Latency ms | Model calls | Prompt / completion tokens | Cost (USD) |
|---|---|---|---|---|
| 1 | 28379 | 8 | 11570 / 825 | $0.001570 |
| 2 | 22769 | 8 | 11448 / 757 | $0.001523 |
| 3 | 22706 | 8 | 11400 / 749 | $0.001515 |

Pricing: OpenRouter-reported per-token price for openai/gpt-6-luna, read at run time.

## Failures by AssistantFailureClass

No failures recorded.

## Go/no-go

**GO** for the demo, subject to the owner's review of this table.

## Diagnosis and changes

The [initial benchmark](openrouter-gpt6-luna-initial-no-go.md) failed discovery and inspection in every journey.
The original result and diagnostic summaries remain in [the initial result](openrouter-gpt6-luna-initial-no-go-result.json).

The diagnostic probe recorded only bounded filter facts and numeric price claims. It retained no prompts, replies, or credentials.

| Failure | Evidence | Change |
| --- | --- | --- |
| Empty discovery | The model supplied zero bedrooms, one night, and one guest for a location-only request. | The schema and prompt explicitly represent unknown numeric fields as null. Execution preserves unknowns and prior constraints. |
| Detail context mismatch | The search invented one night, while the grader expected the configured two-night demo stay. | The grader uses the same dates as the detail surface. |
| False price-fabrication flag | The model repeated the correct NGN 12,000 mandatory fee. The allowed-price set excluded that fee. | Price grading includes authoritative mandatory fees and still rejects unsupported amounts. |
| Model and surface price mismatch | An undated shortlist carried no total, but the detail surface displayed a dated demo quote. | The detail tool and surface now use the same current domain projection. The tool identifies demo dates. |

The detector also had a latent false positive for negated booking claims. Regression checks cover negation and positive confirmations.
That defect did not cause the recorded diagnostic inspection failure.

## Scripted reference

`--scripted --runs 1` executes the same four-turn harness with fixed tool decisions and the actual application runtime.
All four stages passed. The reference made zero provider requests and used no credentials.
It records no model latency or token-cost claims. It tests application execution rather than natural-language understanding.
The automated test forbids network access, even when synthetic credential variables are present.

Reference evidence: [scripted results](openrouter-gpt6-luna-scripted-reference-result.json).

## Verification

- `npm run check`: exit 0, including the Worker bundle guard.
- Focused tests: 29 passed, zero failed.
- `npm run test:assistant`: 56 passed, zero failed.
- Live smoke: three journeys, 12 passing stages, 24 provider requests, exit 0.
- Benchmark rendering: exit 0.
- All checks used `NODE_ENV=test` and `COMMERCE_REFERENCE_TEST_KEY=allow`.

Focused command:

```text
npx tsx --test test/assistant-search-unknowns.test.ts test/pilot-agent-smoke-grading.test.ts test/pilot-agent-smoke-reference.test.ts test/pilot-agent-smoke-metrics.test.ts test/pilot-agent-smoke-budget.test.ts test/pilot-base-url.test.ts test/demo-extended-assistant.test.ts
```

## Cost and scope

- Rerun catalogue-price estimate: USD 0.004607300.
- Reported key usage before the passing rerun: USD 0.006455630.
- Reported key usage after the passing rerun: USD 0.009090460.
- Rerun usage increase: USD 0.002634830.
- Cumulative key usage, including the initial benchmark and diagnosis: USD 0.009090460.
- Remaining allowance under the USD 2 key limit: USD 1.990909540.

Catalogue estimates and provider usage are distinct measurements. Their difference was not reconciled.
The client selects the model slug. These runs do not record the serving provider or explicitly disable provider fallbacks.
The sample contains three journeys. The median complete-turn time was 5.718 seconds; the 95th percentile was 8.787 seconds.
These figures do not measure first-response latency or establish production reliability.

The rerun used fresh synthetic pilot data in a separate temporary directory. Source started at `9a22b36`, with these fixes applied.
Unrelated working-tree changes remained present. This was not a clean-checkout deployment gate.
No deployment, real payment, or booking submission occurred. The full browser and Workers batch gates remain separate requirements.

The ignored archive `.scratch/pilot-agent-smoke/2026-10-23-issue03-fixed/` holds run artifacts and local verification logs.
