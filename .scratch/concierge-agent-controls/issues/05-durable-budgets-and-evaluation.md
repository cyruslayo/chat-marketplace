# Bound abuse with durable quotas and evaluate the complete controls

Status: claimed
Blocked by: 04

## What to build

Implement control 5 and ADR 0106 using existing storage, rate-limit, and configuration patterns.
Persist and atomically reserve per-provider-request capacity before network calls, including classifiers, planner calls, retries, and fallbacks.
Support guest/session and deployment/tenant limits across concurrency and restart.
Use the shared platform remote port for Cloudflare quota authority where domain objects have separate stores (ADR 0101).
Do not add a third-party service or pretend a local map provides global enforcement.
Reuse existing configurable limits; document any added engineering settings and test their validation.
Keep account-level OpenRouter caps as a separate backstop. Do not change remote account settings or infer management-key permission.
Add metadata-only counters/timings and reproducible benign/adversarial evaluations through the complete runtime.
Measure guard failures, false refusals, task completion, prohibited effects, tokens, latency, and cost separately.
Record rejected-plan fallback, scope redirects, tool denials, quota refusal, and successful model handling as separate outcomes.
Preserve failed live evidence. Use synthetic data and the approved key cap for bounded live checks.
The legacy smoke cap is ten provider attempts per journey. A guarded four-turn journey can require twelve successful attempts.
Add an explicit configurable controlled-evaluation request limit; document the chosen value and retain the hard USD key cap.
Do not hide classifier, retry, or fallback attempts from that limit.

## Acceptance criteria

- [ ] AC1: Concurrent requests cannot exceed configured per-guest or deployment/tenant request reservations.
- [ ] AC2: Restart/cold-start cannot reset daily reservations or bypass guest rate limits; storage failures stop paid generation safely.
- [ ] AC3: Every actual provider attempt is reserved, including guard calls, retries, and fallback providers, without double-counting or unbounded retries.
- [ ] AC4: Exhaustion, provider refusal, and guard outage preserve conventional workflows and authorized deterministic pending decisions.
- [ ] AC5: Node and Cloudflare hosts use persistent quota authority; cross-object requests cannot bypass shared platform limits.
- [ ] AC6: Adversarial and benign suites cover all five controls, with observable effects and truthful output assertions.
- [ ] AC7: Guest captures pass at 320, 390, 768, and 1280 pixels, with overflow and target checks; the sequential browser gate passes.
- [ ] AC8: `npm run check`, full `npm run test:workers`, and full `npm test` pass with durable commands, logs, counts, and exit codes.

## ADR compliance

Use PRD's ADR map and ADR 0106. Never run tests against a live database or apply remote migrations.
Prepare only the synthetic live model checks; respect the existing approved key cap and do not deploy or move money.

## Comments

Keep the batch claimed until complete integrated evidence and independent review are recorded.

23 Oct preflight: read-only OpenRouter /auth/key metadata confirms limit USD2, usage USD0.01443705, remaining USD1.98556295. No paid model request or account-setting change occurred. Recheck before the live evaluation.

Model metadata preparation: OpenRouter /api/v1/models still lists exact slug openai/gpt-6-luna. Its supported_parameters include response_format, structured_outputs, tools and max_completion_tokens. Public catalogue price was USD0.0000001 per input token and USD0.0000005 per output token for this context tier. This was a metadata read, not a paid inference. Recheck actual cost and limits for the eventual synthetic run.

24 Oct control-5 continuation pre-edit review: ADR table and context mapping.

| ADR | Constraint | AC / path |
|---|---|---|
| 0015, 0077, 0089 | Server-owned price facts retain meaning across channels. | AC4/AC7: quota fallback cannot invent or mutate price/status output. |
| 0068–0069 | Platform owns adapters and pinned protocol contracts. | AC3–5: guarded adapters and host composition. |
| 0070–0071 | Server identities stay distinct; projections stay redacted. | AC1–2/AC6: tenant/guest ownership and metadata-only evaluation. |
| 0072 | Consequential effects use the authenticated platform command gate. | AC4: pending confirmation/cancellation keeps deterministic path. |
| 0073–0074 | Registered surfaces and safe conventional fallback remain required. | AC4/AC7: quota/unavailable UI behavior and captures. |
| 0075–0076 | Minimize interaction data; stop automation during human ownership. | AC2/AC6: safe failure and metadata-only metrics. |
| 0078 | 320px reflow and accessible targets remain required. | AC7: captures and responsive assertions. |
| 0079 | Timeouts/retries are bounded and observable. | AC3/AC6: deadlines, attempt counts, metrics. |
| 0080 | Critical workflows retain deterministic parity. | AC4: conventional routes and authorized pending decisions. |
| 0099 | Platform owns model/agent/storage; hosts compose; domain packs stay separate. | AC3/AC5: shared quota port and host roots. |
| 0101 | Platform object owns shared cross-domain Cloudflare authority. | AC1/AC2/AC5: PlatformDO RPC and storage. |
| 0102 | Shortlet catalogue output remains registered and authoritative. | AC7: existing guest kit and state. |
| 0105 | Synthetic demo scope and processor constraints remain. | AC6/AC7: synthetic checks and captures. |
| 0106 | Approved controls, provider defaults, and execution order remain. | AC1–AC8: complete control 5; exact `openai/gpt-6-luna`. |

Contexts read: platform-core, Shortlet, and Commerce. `npm run check` before edits failed with seven TypeScript errors: two Gemini optional-timeout errors, three type-only value-import errors, and two quota test union-narrowing errors. No code changes were made after this check.

24 Oct control-5 phase-A focused evidence after host wiring and deadline fixes:

- `npm run check` passed. The Worker bundle guard found no Node SQLite import in the Worker graph.
- `$env:NODE_ENV='test'; $env:COMMERCE_REFERENCE_TEST_KEY='allow'; npx tsx --test test/model-quota-guard.test.ts test/model-request-quota.test.ts test/openai-compatible-client.test.ts test/concierge-configuration.test.ts test/pilot-production-composition.test.ts test/pilot-database-handle.test.ts test/pilot-guardrails.test.ts` passed 47 tests, with 0 failures, cancellations, or skips; exit 0.
- `npm run test:workers -- test/platform-model-request-quota.spec.ts` passed 1 test in 1 file; exit 0. The Worker emitted dependency sourcemap warnings only.
- `git diff --check` passed before later documentation edits; rerun before commit.

Failed attempts retained in conversation evidence and addressed: the pre-edit check reported seven TypeScript errors; a later check found the missing Worker test `Env.SHORTLET_TENANT_ID` type. The first combined guard run had 13 passes and 1 failure because an immediate fake transport was incorrectly expected to exceed its timeout; the test now uses a delayed quota reservation. The parent's initial affected-host run reported 29 passes and 3 failures before attempt-aware test doubles and the typed-reply assertion were updated. The corrected combined command above passed.

The durable host gate is not complete. Parent review findings remain open for approved support guidance and persisted server-owned outcome wording. Phase B metrics/evaluation, capture fixtures, live synthetic checks, full Workers, and full `npm test` remain pending. No paid inference ran.

24 Oct phase-A final rerun after adding the AC2 quota-refusal/storage-failure transport assertion:

- `npm run check` passed with exit 0. Full output: `.scratch/concierge-agent-controls/validation/2026-10-24/phase-a-check.log`.
- `$env:NODE_ENV='test'; $env:COMMERCE_REFERENCE_TEST_KEY='allow'; npx tsx --test test/model-quota-guard.test.ts test/model-request-quota.test.ts test/openai-compatible-client.test.ts test/concierge-configuration.test.ts test/pilot-production-composition.test.ts test/pilot-database-handle.test.ts test/pilot-guardrails.test.ts` passed 48 tests, 0 failed/cancelled/skipped; exit 0. Full output: `.scratch/concierge-agent-controls/validation/2026-10-24/phase-a-focused.log`.
- `npm run test:workers -- test/platform-model-request-quota.spec.ts` passed 1 test in 1 file; exit 0. Full output: `.scratch/concierge-agent-controls/validation/2026-10-24/phase-a-worker-quota.log`.
- Parent independently ran the narrower guard/quota/OpenAI gate: 15 passed, 0 failed; output is `.scratch/concierge-agent-controls/validation/2026-10-24/parent-quota-focused.log`.
