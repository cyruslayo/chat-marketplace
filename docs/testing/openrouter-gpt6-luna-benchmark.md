# OpenRouter GPT-6 Luna benchmark

- Date: 2026-10-23
- Provider: openrouter
- Model slug: openai/gpt-6-luna
- Grading profile: price-roles-and-status-v3
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
| Turn | 5060 | 7028 |
| Journey | 21750 | 22633 |

## Per journey

| Journey | Latency ms | Model calls | Prompt / completion tokens | Cost (USD) |
|---|---|---|---|---|
| 1 | 22633 | 8 | 11574 / 828 | $0.001571 |
| 2 | 21750 | 8 | 11576 / 849 | $0.001582 |
| 3 | 20213 | 8 | 11468 / 741 | $0.001517 |

Pricing: OpenRouter-reported per-token price for openai/gpt-6-luna, read at run time.

## Failures by AssistantFailureClass

No failures recorded.

## Go/no-go

**GO** for the evaluated local discovery-to-draft journey, subject to the owner's review.

## Review findings 1 and 2

This run uses `price-roles-and-status-v3`. Earlier runs cannot establish a verdict under this grading profile.
The [pre-review report](openrouter-gpt6-luna-pre-review.md) and [its result](openrouter-gpt6-luna-pre-review-result.json) preserve the earlier evidence.
The [initial failed run](openrouter-gpt6-luna-initial-no-go.md) remains available.

Price checks retain separate authoritative values for nightly rates, accommodation, mandatory fees, deposits, stay totals, and amounts due.
A mandatory fee presented as a full stay total fails. A deposit cannot validate an accommodation price.
Currency checks recognize NGN and ₦ prefixes, plus NGN and naira suffixes. Ambiguous monetary roles fail closed.
Booking-status checks cover completed, secured, paid, and confirmed claims, including active confirmation wording.
Tests distinguish negation and future steps from completed actions. Separate messages cannot share a negation.

These are bounded prose checks. They do not prove correctness for unrestricted language, every listing reference, or every currency representation.
They operate in memory. Reports retain classifications and numbers, rather than prompts or model replies.

Report generation requires four distinct stages per attempted journey. It validates journey identifiers, verdict consistency, requests, budgets, and performance records.
Empty, missing, duplicate, unknown, contradictory, or malformed evidence is refused.
A complete failed run produces NO-GO. A single complete journey produces INCOMPLETE for this three-journey benchmark.

## Intermediate failure and accommodation subtotal

The first stricter run used profile v2. Eleven of 12 stages passed; one inspection was classified as a verification failure.
Its numeric trace included NGN 190,000. The retained trace does not contain the claim's label.
That value equals the domain quote's accommodation subtotal. The first stricter grader did not support that role.

Profile v3 reads the subtotal from the domain quote. It accepts that value only when the reply identifies accommodation or a subtotal.
Regression tests still reject NGN 190,000 when presented as the full NGN 202,000 stay total.
The [v2 NO-GO result](openrouter-gpt6-luna-role-check-v2-no-go-result.json) remains unchanged. Its saved replies cannot be regraded because they were not retained.
The current table comes from a fresh three-journey run under v3.

## Verification

- `npm run check`: exit 0, including the Worker bundle guard.
- Focused tests: 34 passed, zero failed.
- Scripted reference: four stages passed with zero provider requests and no live performance claims.
- Current live run: three journeys, 12 passing stages, 24 provider requests, exit 0.
- Report generation: exit 0 after strict evidence validation.
- No application, provider default, deployment setting, dependency, or business policy changed in these review fixes.

Focused command, with `NODE_ENV=test` and `COMMERCE_REFERENCE_TEST_KEY=allow`:

```text
npx tsx --test test/pilot-agent-smoke-grading.test.ts test/pilot-agent-smoke-report.test.ts test/pilot-agent-smoke-metrics.test.ts test/pilot-agent-smoke-reference.test.ts test/pilot-agent-smoke-budget.test.ts test/pilot-base-url.test.ts
```

## Cost and acceptance limits

- Current run catalogue-price estimate: USD 0.004670800.
- Key usage before the current run: USD 0.011871950.
- Key usage after the current run: USD 0.014437050.
- Current run usage increase: USD 0.002565100.
- Both live review runs used 48 provider requests. Their combined key usage increase was USD 0.005346590.
- Remaining allowance under the USD 2 key limit: USD 1.985562950.

Provider usage and catalogue estimates are distinct measurements. Their difference remains unreconciled.
The model slug is selected explicitly. Serving-provider identity and provider fallbacks remain outside this evidence.
Median complete-turn latency was 5.060 seconds. The 95th percentile was 7.028 seconds across 12 turns.
These figures do not measure first-response latency or establish production reliability.

The run used fresh synthetic pilot data. Source started at `6ae88cc`, with the review fixes applied and unrelated changes present.
This verifies the fixed four-turn local journey. Broader scenarios, Extended Stay journeys, staging browser checks, and public acceptance remain outstanding.
No deployment, booking submission, real payment, push, full browser suite, or full Workers gate occurred.

Numeric results: [current live evidence](openrouter-gpt6-luna-benchmark-result.json) and [scripted reference](openrouter-gpt6-luna-scripted-reference-result.json).
The ignored archive `.scratch/pilot-agent-smoke/2026-10-23-review-fixes/` holds local logs and bounded numeric traces.
