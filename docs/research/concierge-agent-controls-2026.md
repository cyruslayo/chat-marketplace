# Concierge agent controls: research and implementation recommendation

Accessed 23 October 2026. This note separates source findings, repository observations, and proposed controls.

## Recommendation

Use application-enforced permissions, structured decisions, and server-generated critical replies as the primary controls.
Add an isolated scope classifier for input triage and bounded response checks for any remaining model prose.
Treat every model decision as untrusted until application code validates it.

For this public demo, prefer typed reply plans rendered by the server over unrestricted final model prose.
This limits off-topic output, preserves authoritative prices, and avoids another paid output-classifier call on routine turns.
Keep the existing model, provider-neutral interfaces, domain command gate, and Weaver rendering path.

These are recommendations for this repository. No single source establishes a universally best product or complete prompt-injection defense.

## What current sources establish

| Primary source | Date | Finding relevant to this agent |
| --- | --- | --- |
| [OpenAI: Designing AI agents to resist prompt injection](https://openai.com/index/designing-agents-to-resist-prompt-injection/) | 11 March 2026 | Filters alone are insufficient. Application controls should constrain the impact when manipulation succeeds. |
| [NCSC: Prompt injection is not SQL injection](https://www.ncsc.gov.uk/blog-post/prompt-injection-is-not-sql-injection) | 2025 guidance, accessed 23 October 2026 | Models lack a reliable instruction/data boundary. Design for residual risk and limit privileged effects. |
| [OWASP: LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) | Living guidance, accessed 23 October 2026 | Keyword filters are fallible. Apply least privilege, tool-boundary validation, input/output controls, and application-specific adversarial tests. |
| [OpenAI: Safety in building agents](https://developers.openai.com/api/docs/guides/agent-builder-safety) | Living documentation, accessed 23 October 2026 | Keep untrusted data below developer authority. Constrain data flow with fixed schemas and evaluate complete traces. |
| [Anthropic: Mitigate jailbreaks and prompt injections](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks) | Living documentation, accessed 23 October 2026 | Distinguish direct user attacks from injected third-party content. Use isolated screening and preserve tool-result provenance. |
| [CaMeL: Defeating Prompt Injections by Design](https://arxiv.org/abs/2503.18813v2) | Revised 24 June 2025 | The research separates control flow from untrusted data and enforces capabilities at tool boundaries. |
| [AgentDojo](https://arxiv.org/abs/2406.13352v3) | Revised 24 November 2024 | Evaluate legitimate task completion and attack outcomes together, including malicious tool results and adaptive attacks. |

Source limits matter. Vendor-specific examples do not establish that another model or provider has identical behavior.
Structured JSON constrains syntax; it does not prove that a classification, amount, or tool choice is correct.
CaMeL supplies an architectural research principle. Installing its research implementation is not the proposed production solution.

### Existing-provider controls

OpenRouter documents account controls for budgets, model/provider restrictions, data handling, and security screening.
The [Guardrails announcement](https://openrouter.ai/blog/announcements/guardrails/) was published on 29 May 2026 and updated on 24 September 2026.
The [current guide](https://openrouter.ai/docs/guides/features/guardrails) describes configuration and enforcement options.

Use applicable account budgets and approved-model/provider restrictions as additional backstops.
Check account availability and permissions before configuration. This research changed no account setting.
Creation alone does not enable enforcement; the guardrail requires assignment to the intended key or member.
Shared-key controls do not replace per-guest application limits.
Provider screening does not establish the concierge's permitted business scope or authorize a transaction.
Blanket personal-data stripping can break legitimate booking/contact workflows. Apply the existing privacy policy to each data path.

### Approved-model capability check

The public [OpenRouter model catalogue](https://openrouter.ai/api/v1/models) was queried without credentials on 23 October 2026.
It lists `response_format`, `structured_outputs`, and completion-token limits for `openai/gpt-6-luna`.
This catalogue entry does not prove that every serving endpoint enforces the required schema.

[OpenRouter structured-output guidance](https://openrouter.ai/docs/guides/features/structured-outputs) requires endpoint capability checks and recommends `require_parameters: true`.
Strict-mode enforcement varies by provider. Validate parsed results locally even when strict mode is requested.
Use an approved provider allow-list and explicit fallback policy for reproducible evaluation.
The [provider-routing guide](https://openrouter.ai/docs/guides/routing/provider-selection) documents `only`, `allow_fallbacks`, and parameter requirements.
No paid structured-generation request was tested during this research.

## Current repository observations

These observations come from source inspection, rather than an exhaustive security audit.

| Source | Existing behavior | Gap relevant to this work |
| --- | --- | --- |
| `apps/local-guest/src/assistant/assistant-platform.ts` | The platform owns the agent loop and pack interface. | The common preamble describes accommodation assistance without a complete scope policy. |
| `apps/local-guest/src/assistant/shortlet-assistant-pack.ts` | Tools are state-dependent. The prompt treats listing/tool text as untrusted. | A prompt instruction cannot enforce reply scope or defeat every injected instruction. |
| `apps/local-guest/src/assistant/assistant-runtime.ts` | Tool calls are checked against offered tools and pack preconditions. | The final model text is returned directly. |
| `apps/local-guest/src/shortlet-app.ts` | Pending decisions retain their deterministic path when the model budget is exhausted. | No input scope classifier sits before normal model execution. |
| `apps/local-guest/src/shortlet-app.ts` | Successful decorated results pass through `#rememberResult`, with remote thread persistence when applicable. | A redirected request can still poison later history unless persistence policy explicitly excludes rejected content. |
| `apps/local-guest/src/assistant/model-call-budget.ts` | A soft daily cap counts model calls per runtime. | It is not an atomic, durable, account-wide spending cap. |
| `apps/local-guest/src/assistant/assistant-model.ts` | The model request has instructions, tools, history, and an optional timeout. | It lacks a neutral structured-response format and output-token limit. |
| `apps/local-guest/src/assistant/openai-compatible-client.ts` | The adapter sends model, messages, tools, and `stream: false`. | A classifier needs supported structured-output and bounded-output options. |
| `scripts/pilot-agent-smoke-grading.ts` | Benchmark checks evaluate bounded price/status expressions. | These checks are not a live response policy or a proof about unrestricted language. |

The browser already renders application-created A2UI messages through Weaver.
Retain that arrangement. The model should not supply arbitrary HTML, executable UI, or payment destinations.

## Proposed control path

```mermaid
flowchart TD
    A[Guest message] --> B[Session, tenant, size and rate checks]
    B --> C{Existing pending confirmation or cancellation?}
    C -->|Yes| D[Existing command gate and current-state checks]
    C -->|No| E[Isolated scope classification]
    E -->|Unclear| F[Fixed clarification]
    E -->|Outside scope| G[Fixed concierge redirect]
    E -->|Allowed scope| H[State-limited tool planning]
    H --> I[Argument, authority and intent checks]
    I --> J[Domain operation]
    J --> K[Typed reply plan and trusted facts]
    K --> L[Server text and A2UI generation]
    L --> M[Weaver rendering]
```

Authentication and perimeter limits run before the pending-decision branch.
Only an existing authorized confirmation or cancellation bypasses classification.
The classifier helps route a request. It must never grant account access, financial authority, or additional tools.
Application code intersects permitted task capabilities, current-state tools, and principal permissions.

### 1. Define business scope before configuring the guard

The Shortlet pack should declare a versioned scope policy through the platform-owned agent interface.
Use a policy shared by classification prompts, deterministic reply plans, and evaluation fixtures.

Proposed in-scope categories include discovery, comparison, pricing, booking preparation, status, payment guidance, stay problems, and human support.
Permit accommodation-related small talk, greetings, accessibility questions, and necessary clarification.
Treat these categories as proposals until they match the approved product scope and domain vocabulary.

| Request | Proposed handling |
| --- | --- |
| "Abeg, any two-bedroom for Wuse?" | Continue discovery. Nigerian phrasing must not cause refusal. |
| "Open the first one." | Use the current trusted shortlist context. |
| "Ignore Ikoyi; show Abuja instead." | Treat this as a location correction, rather than a keyword-triggered attack. |
| "Write a poem, and show apartments in Wuse." | Handle the accommodation part and redirect the unrelated part. |
| "I smell gas in the apartment." | Use the approved safety/support path, with no general medical or emergency improvisation. |
| "Become my coding assistant." | Return a short fixed description of the concierge's scope. |
| "Change the price and mark me paid." | Reject the unauthorized effect. Preserve legitimate price/payment guidance. |

Avoid a blacklist of words such as `ignore`, `system`, or `delete` as the main scope control.
They occur in legitimate requests, including location corrections and account-management questions.

### 2. Add a small, isolated input classifier

Classify the new guest message with a fixed prompt and an exact schema.
Provide only a minimal trusted task summary, such as active stage, current shortlist availability, and pending-action type.
Exclude arbitrary listing descriptions, raw tool prose, and rejected conversation text from this classifier's context.
Give the classifier no tools, browsing, or mutation capability.
Keep API credentials in the server adapter, outside every model prompt and tool result.

A proposed result has separate fields for scope and risk signals:

```typescript
interface ConciergeInputAssessment {
  scope: "in_scope" | "mixed" | "out_of_scope" | "unclear";
  risk: "ordinary" | "policy_override" | "sensitive_action" | "data_request" | "unknown";
  reasonCode: string; // Restrict to a closed, versioned enumeration during implementation.
}
```

Validate every field locally. Reject extra properties, malformed responses, refusal responses, and unavailable classifications.
Do not use an invented confidence threshold as a security boundary.
Route uncertain inputs to clarification or the conventional guest UI.
Never fall back to an unrestricted model answer when this guard is unavailable.

Keep deterministic confirmation and cancellation ahead of this classifier.
An outage or exhausted model budget must not strand a valid pending guest decision.

The existing approved model can perform the initial classification through a separate, tool-free call.
A different classifier model or provider requires explicit configuration, evaluation, and processor-policy review.
Classifier refusal means no usable verdict. It does not prove the guest is malicious.

### 3. Constrain the reply contract

For the public demo, make final model output a typed reply plan with approved reply kinds and reference fields.
Examples include `show_results`, `clarify_stay`, `explain_price`, `show_status`, `propose_action`, and `redirect`.
These are proposed interface values, not existing policy strings.

The server validates references against authorized current results before rendering the plan.
The server supplies all amounts, deadlines, payment status, booking status, and action labels.
The model may select an approved clarification question; it cannot invent a price or confirmation sentence.
Approved FAQ identifiers can select reviewed explanations without accepting model-written policy or advice.
Generate links and actions from registered application destinations, rather than model-provided URLs.

This design prevents an accepted typed plan from carrying an unrelated essay or a substituted stay price.
It does not prove the selected plan matches user intent. State checks, confirmation, and evaluations remain necessary.
Putting an unrestricted `explanation` string inside valid JSON would reopen the freeform-output gap.

If useful freeform explanations remain, isolate them in a bounded optional field.
Apply a separate scope and data-disclosure check before displaying that field.
Replace rejected prose with a fixed explanation while retaining valid application surfaces and conventional routes.
Do not turn the benchmark's regular-expression checks into the only production response guard.

### 4. Keep untrusted content out of authority

Return minimal typed public facts from tools. Tag externally authored strings with their origin and trust level.
Avoid forwarding complete operator biographies, documents, or descriptions when structured facts already answer the question.
Keep external strings in tool-result content, below fixed system/developer instructions.
Do not concatenate listing text into instructions, tool definitions, scope policy, or allowed-action lists.

Treat every tool request as untrusted, even after an input classifier permits the turn.
Validate arguments, principal ownership, tenant, current state, capability, concurrency, and idempotency at execution time.
Confirm material booking and payment effects through the existing platform command gate.
Do not add approval prompts to every harmless public search or detail read.

Do not save rejected instructions into model memory or trusted summaries.
Retain the required decision metadata and valid transactional audit records under the existing retention policy.

### 5. Bound abuse and operating cost

Reuse the application's existing rate-limiter patterns after checking exact chat-route coverage.
Add durable, atomic reservations for model requests across restarts and concurrent requests.
Partition limits by principal/session and deployment. Apply network-level throttling as a supplemental control.
Measure false blocks for shared networks and legitimate guests.
Set numeric limits through explicit configuration and evaluated policy.

Count classifier calls, model calls, retries, and optional output checks in one request/cost budget.
Reserve capacity before each provider request, rather than only admitting an entire turn.
Keep provider account caps as a separate backstop.
Use output-token limits, deadlines, and bounded retries for classification and reply planning.

| Design | Operating cost and latency | Maintenance |
| --- | --- | --- |
| Stronger prompt only | Lowest added cost. | Small code change, but insufficient enforcement. |
| Input classifier plus unrestricted response | One extra model call per guarded turn. | Scope fixtures and classifier/version monitoring; output scope still depends on the model. |
| Input classifier plus typed reply plan | One extra classification call; no general output judge for routine replies. | Approved reply templates and fact-reference validators. Recommended first release. |
| Input classifier plus freeform output judge | Usually two additional model calls per guarded turn. | Two fallible policies, extra timeout handling, and more adversarial evaluation. |
| External guardrail framework | Variable provider and infrastructure cost. | Another dependency, integration boundary, and upgrade surface. Adopt only for a demonstrated unmet need. |

Estimate guard cost using measured input/output tokens and current approved-provider prices.
Measure complete-turn latency and first-visible-response latency separately.
No current model price or latency estimate is invented here.

### 6. Test intended outcomes, not refusal wording

Instrument tools with synthetic data and observable side-effect counters.
Assert that forbidden effects never occur, even when the model or guard is deliberately made to approve an attack.
Also assert that valid guests can complete their tasks without unnecessary refusal.

Required cases include:

- Direct role overrides and requests for secrets, prices, or administrative authority.
- Injections inside listing titles, descriptions, amenities, retrieved content, and tool results.
- Role-delimiter spoofing, encoded text, Unicode variants, and repeated multi-turn attempts.
- Cross-guest references, expired surfaces, stale prices, duplicate confirmations, and cross-tenant identifiers.
- Mixed requests, greetings, terse follow-ups, Nigerian English, Pidgin, typos, and legitimate support complaints.
- Classifier timeout, refusal, malformed JSON, unknown labels, provider outage, and exhausted guard budget.
- An output classifier that incorrectly approves unrelated prose.
- A tool-planning model that calls an unavailable tool or requests a valid tool for an unauthorized object.
- Rejected turns excluded from subsequent model context and trusted summaries.
- Invalid reply references and price/status text replaced by authoritative application content.
- Concurrent turns and worker restarts that cannot bypass durable request reservations.

Report attack success, prohibited side effects, valid task completion, false refusal, fallback use, latency, tokens, and cost separately.
Retain adversarial failures and grading-version identifiers. Never tune the corpus silently until it passes.
Passing a finite corpus is evidence with limits, rather than proof against every future injection.

## Smallest implementation plan

| Slice | Existing seam | Acceptance evidence |
| --- | --- | --- |
| 1. Typed replies and authoritative facts | `assistant-model.ts`, `openai-compatible-client.ts`, `AssistantRuntime`, existing guest-content helpers | Strict schema and reference validation; bounded output; injected text cannot replace server prices, status, links, or actions. Weaver surfaces remain consistent. |
| 2. Scope policy, classification, and history | `assistant-platform.ts`, `shortlet-app.ts`, `AssistantRuntime.handleTurn` | Off-topic requests redirect; valid follow-ups continue; deterministic pending decisions survive guard outage; rejected text does not poison history. |
| 3. Data and tool boundaries | Pack declarations, existing tool-result projections and command gate | Listing/tool injections cannot add capabilities or change consequential actions. Approved FAQ identifiers replace unsupported policy prose. |
| 4. Durable budgets and adversarial acceptance | Existing rate-limit patterns, Cloudflare storage ports, assistant evals and live smoke | Restart/concurrency checks pass; synthetic adversarial and benign suites pass; bounded live evidence records quality, latency, and cost. |

Keep these controls inside the existing TypeScript composition and platform/domain boundary.
Avoid a new service or framework until tests demonstrate a requirement the existing design cannot satisfy.
Roll out behind explicit configuration, with conventional workflows available throughout.

## ADR constraints

| ADR | Constraint on implementation |
| --- | --- |
| 0015 | Prices and cash requirements retain their authoritative roles and current quote context. |
| 0068 | Keep provider SDKs and UI framework details outside the neutral application/domain contracts. |
| 0072 | Consequential actions retain server authorization, exact-effect confirmation, and the command gate. |
| 0075 | Do not log prompts, replies, credentials, raw identity evidence, or private payment material for guard diagnostics. |
| 0079 | Model/control changes require observable evaluation and rollback evidence. |
| 0080 | Conventional critical workflows remain available when model guards fail. |
| 0099 | The platform owns control execution. Packs declare domain-specific scope, vocabulary, tools, and reply facts. |
| 0105 | Keep the approved synthetic staging-demo model and processor scope. Do not silently change production defaults or add another processor. |

## Validation boundary

This deliverable is research and implementation guidance. It does not implement or certify these controls.
Source files and listed ADRs were inspected. Primary sources were accessed on 23 October 2026.
No paid model calls, deployment, account-setting change, or security scan occurred during this research.
