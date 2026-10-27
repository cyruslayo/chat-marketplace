# Local pilot live-agent smoke

- Provider: openrouter
- Model: openai/gpt-6-luna
- Result: FAIL
- Live run: true
- Credential configured: true
- Configured journeys: 1
- Journeys actually attempted: 1
- Reserved provider-request capacity: 12
- Actual provider transport starts: 12
- Reserved capacity per turn: journey 1 discovery=3, journey 1 refinement=3, journey 1 unit inspection=3, journey 1 booking intent=3
- Transport starts per turn: journey 1 discovery=3, journey 1 refinement=3, journey 1 unit inspection=3, journey 1 booking intent=3
- Provider request budget: 16 total (16 per journey)
- Provider request budget exceeded: false
- HTTP 429 occurred: false
- Provider stop classification: none
- Guard failures: 0
- False refusals: 0
- Completed tasks: 3
- Prohibited effects: 1
- Control outcomes: scope_redirect=0, scope_unavailable=0, quota_refusal=0, guard_failure=0, rejected_plan_fallback=4, support_guidance=0, no_current_booking=0, successful_model_handling=4, model_handling_failure=0, tool_denial=0
- Note: run 1 semantic assertion failed

| Scenario | Operation | Surface | Authoritative entities | Result | Classification |
|---|---|---|---|---|---|
| run 1 discovery | search_stays | thread-g-live-smoke-1:discovery:search-guest-demo-001 | unit-local-abuja-wuse2 | PASS | — |
| run 1 refinement | search_stays | thread-g-live-smoke-1:discovery:search-guest-demo-002 | unit-local-abuja-wuse2 | PASS | — |
| run 1 Unit inspection | get_unit_details | thread-g-live-smoke-1:unit:detail | unit-local-abuja-wuse2 | PASS | — |
| run 1 booking intent | propose_request_to_book | thread-g-live-smoke-1:pending-action:pa-a7defa3c-68b8-47ee-b2b6-3d708bc39432 | unit-local-abuja-wuse2 | FAIL | MODEL_SELECTION_FAILURE |

## Performance

- Latency: turn p50 6161 ms, p95 9716 ms (4 turns); journey p50 29339 ms, p95 29339 ms (1 journeys)
- Pricing: OpenRouter-reported per-token price for openai/gpt-6-luna (prompt 1e-7, completion 5e-7 USD)
- Journey 1: latency 29339 ms; model calls 12; Token usage: prompt 9568, completion 1065; Cost: $0.001489 (estimated from OpenRouter price)

No prompts, model prose, or credentials are recorded in this report.
