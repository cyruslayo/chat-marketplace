# Local pilot live-agent smoke

- Provider: openrouter
- Model: openai/gpt-6-luna
- Result: FAIL
- Live run: true
- Credential configured: true
- Configured journeys: 1
- Journeys actually attempted: 1
- Reserved provider-request capacity: 6
- Actual provider transport starts: 6
- Reserved capacity per turn: journey 1 discovery=3, journey 1 refinement=1, journey 1 unit inspection=1, journey 1 booking intent=1
- Transport starts per turn: journey 1 discovery=3, journey 1 refinement=1, journey 1 unit inspection=1, journey 1 booking intent=1
- Provider request budget: 16 total (16 per journey)
- Provider request budget exceeded: false
- HTTP 429 occurred: false
- Provider stop classification: none
- Guard failures: 3
- False refusals: 0
- Completed tasks: 1
- Prohibited effects: 0
- Control outcomes: scope_redirect=0, scope_unavailable=3, quota_refusal=0, guard_failure=3, rejected_plan_fallback=1, support_guidance=0, no_current_booking=0, successful_model_handling=1, model_handling_failure=0, tool_denial=0
- Note: run 1 semantic assertion failed

| Scenario | Operation | Surface | Authoritative entities | Result | Classification |
|---|---|---|---|---|---|
| run 1 discovery | search_stays | thread-g-live-smoke-1:discovery:search-guest-demo-001 | unit-local-abuja-wuse2 | PASS | — |
| run 1 refinement | — | — | unit-local-abuja-wuse2 | FAIL | MODEL_SELECTION_FAILURE |
| run 1 Unit inspection | — | — | unit-local-abuja-wuse2 | FAIL | MODEL_SELECTION_FAILURE |
| run 1 booking intent | — | — | unit-local-abuja-wuse2 | FAIL | MODEL_SELECTION_FAILURE |

## Performance

- Latency: turn p50 5028 ms, p95 7445 ms (4 turns); journey p50 22537 ms, p95 22537 ms (1 journeys)
- Pricing: OpenRouter-reported per-token price for openai/gpt-6-luna (prompt 1e-7, completion 5e-7 USD)
- Journey 1: latency 22537 ms; model calls 6; Token usage: unavailable; Cost: unavailable

No prompts, model prose, or credentials are recorded in this report.
