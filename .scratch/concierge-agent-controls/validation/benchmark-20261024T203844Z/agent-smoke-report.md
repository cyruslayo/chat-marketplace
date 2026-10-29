# Local pilot live-agent smoke

- Provider: openrouter
- Model: openai/gpt-6-luna
- Result: PASS
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
- Completed tasks: 4
- Prohibited effects: 0
- Control outcomes: scope_redirect=0, scope_unavailable=0, quota_refusal=0, guard_failure=0, rejected_plan_fallback=4, support_guidance=0, no_current_booking=0, successful_model_handling=4, model_handling_failure=0, tool_denial=0
- Note: All semantic assertions passed.

| Scenario | Operation | Surface | Authoritative entities | Result | Classification |
|---|---|---|---|---|---|
| run 1 discovery | search_stays | thread-g-live-smoke-1:discovery:search-guest-demo-001 | unit-local-abuja-wuse2 | PASS | — |
| run 1 refinement | search_stays | thread-g-live-smoke-1:discovery:search-guest-demo-002 | unit-local-abuja-wuse2 | PASS | — |
| run 1 Unit inspection | get_unit_details | thread-g-live-smoke-1:unit:detail | unit-local-abuja-wuse2 | PASS | — |
| run 1 booking intent | prepare_request_draft | thread-g-live-smoke-1:request:draft:draft-0220192d-a643-4679-91b8-3e0d41278b25 | unit-local-abuja-wuse2 | PASS | — |

## Performance

- Latency: turn p50 6495 ms, p95 8254 ms (4 turns); journey p50 28868 ms, p95 28868 ms (1 journeys)
- Pricing: OpenRouter-reported per-token price for openai/gpt-6-luna (prompt 1e-7, completion 5e-7 USD)
- Journey 1: latency 28868 ms; model calls 12; Token usage: prompt 9824, completion 659; Cost: $0.001312 (estimated from OpenRouter price)

No prompts, model prose, or credentials are recorded in this report.
