# OpenRouter GPT-6 Luna benchmark

- Date: 2026-10-23
- Provider: openrouter
- Model slug: openai/gpt-6-luna
- Live journeys: 3 of 3 configured (3 required for the benchmark)
- Offline reference: scripted model is not run by this document (see issue 03 Comments)

## Pass rate per grading dimension

| Dimension | Pass |
|---|---|
| discovery | 0 / 3 |
| refinement | 3 / 3 |
| unit inspection | 0 / 3 |
| booking intent | 3 / 3 |

## Latency (ms)

| Measure | p50 | p95 |
|---|---|---|
| Turn | 8024 | 11767 |
| Journey | 33998 | 36044 |

## Per journey

| Journey | Latency ms | Model calls | Prompt / completion tokens | Cost (USD) |
|---|---|---|---|---|
| 1 | 36044 | 8 | 9479 / 1489 | $0.001692 |
| 2 | 25936 | 8 | 9529 / 911 | $0.001408 |
| 3 | 33998 | 8 | 9531 / 1524 | $0.001715 |

Pricing: OpenRouter-reported per-token price for openai/gpt-6-luna, read at run time.

## Failures by AssistantFailureClass

- MODEL_SELECTION_FAILURE: 3
- FABRICATION_FAILURE: 3

## Go/no-go

**NO-GO**: at least one journey fabricated a price or a booking claim (ADR 0080). Recorded, not tuned away.

## Review and limits

The verdict above is the smoke script's classification. All three inspection turns triggered `FABRICATION_FAILURE`.
The report omits model prose under ADR 0075. These records cannot establish the exact offending claim.
Review the grading checks before attributing these flags to confirmed model fabrication. Keep the NO-GO verdict during that review.

All three discovery turns returned zero units despite selecting `search_stays` and preserving the Wuse 2 context.
Each refinement then returned the synthetic Wuse 2 unit. The report does not retain search arguments.
The discovery cause remains unconfirmed. `MODEL_SELECTION_FAILURE` is the script's fallback classification, despite a successful search operation.

All 12 turns passed the surface rendering check. All three booking turns created drafts requiring guest review.
The booking checks found no request submission, offer, reservation, contract, or payment operation.
The results do not approve deployment or a model change.

## Cost and evidence

- Source commit: `9a22b36`, with unrelated working-tree changes present.
- Live run: 23 October 2026, completed at 06:44:48 UTC (07:44:48 Africa/Lagos).
- Provider requests: 24 of the 30-request budget; eight per journey.
- Tokens: 28,539 prompt tokens and 3,924 completion tokens.
- Total catalogue-price estimate: USD 0.004815900.
- OpenRouter key usage before the run: USD 0.
- OpenRouter key usage after the run: USD 0.003851435.
- Reported usage increase: USD 0.003851435; remaining key allowance: USD 1.996148565.
- The key has a USD 2 limit. No credential value is recorded.
- The catalogue estimate and provider usage are separate measurements. The run did not reconcile their difference.
- Live result: [numeric results and diagnostic summaries](openrouter-gpt6-luna-initial-no-go-result.json).
- Ignored local archive: `.scratch/pilot-agent-smoke/2026-10-23-issue03/`.

The run used a new synthetic pilot in a separate temporary directory. The existing September pilot data was preserved.
The script ran in-process with a deterministic payment adapter. It did not target a deployed server.
The client selected the model slug. This run did not record the serving provider or explicitly disable provider fallbacks.
The latency figures cover complete turns and journeys, rather than first-response latency.
Three journeys provide limited evidence. They do not establish production reliability.

## Offline checks

- `npm run check`: exit 0, including the Worker bundle guard.
- `npx tsx --test test/pilot-agent-smoke-metrics.test.ts test/pilot-agent-smoke-budget.test.ts test/pilot-base-url.test.ts`: 20 passed, zero failed.
- `npm run test:assistant`: 56 passed, zero failed.
- All checks used `NODE_ENV=test` and `COMMERCE_REFERENCE_TEST_KEY=allow`.

The offline assistant tests use scripted models. The separate four-turn scripted reference remains unfinished.
These tests do not replace that reference or the failed live journey checks.

## Later diagnosis

This initial evidence remains unchanged except for its result-file link and this note.
The inspection flags were caused by a grader that excluded valid mandatory fees.
The model also supplied unrequested search defaults. Its one-night search conflicted with the grader's two-night expectation.
The detail tool could give the model an undated price while its surface showed a dated demo quote.
The [current benchmark](openrouter-gpt6-luna-benchmark.md) records the fixes and the passing rerun.
