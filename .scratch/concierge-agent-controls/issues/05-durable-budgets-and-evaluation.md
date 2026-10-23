# Bound abuse with durable quotas and evaluate the complete controls

Status: ready-for-agent
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
Preserve failed live evidence. Use synthetic data and the approved key cap for bounded live checks.

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
