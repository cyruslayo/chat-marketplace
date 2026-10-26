---
status: accepted
---

# Enforce concierge scope, reply, tool, context, and resource controls

The owner authorized controls 1–5 in chat on 23 October 2026.
The research source is `docs/research/concierge-agent-controls-2026.md`.
Implement in this order: constrained replies, scope classification, tool authorization, context isolation, and durable abuse controls/evaluation.

## Decision

The platform enforces controls. Packs declare their supported intent, reply, tool, and public-fact vocabulary (ADR 0099).
Models never grant permissions or supply contractual or financial authority.
The approved model/provider defaults and the public commerce restriction remain unchanged (ADR 0105).

### Replies

The model may select a typed reply kind, approved clarification, and conversational fact references.
The server supplies wording, facts, prices, deadlines, status, actions, and registered destinations.
Allowed reply kinds cover results, details, comparison, price, status, proposals, clarification, support guidance, and scope redirects.
Reply references must match current authorized results and workflow state.
Arbitrary prose, URLs, HTML, model amounts, extra properties, and invalid plans cannot reach the guest through this reply path.
An invalid or legacy prose response gets a safe server-generated reply based on a completed operation or a fixed clarification.
This compatibility behavior must not enable arbitrary prose or invent an operation's success.
Existing typed Weaver surfaces and deterministic command confirmations remain authoritative.

### Scope

In-scope assistance covers the registered pack's existing discovery, details, comparison, pricing, booking preparation, status, payment guidance, and support routes.
Greetings, necessary clarification, accessibility questions, and accommodation-related support remain in scope.
These categories do not authorize new transactions, exceptional remedies, legal advice, medical advice, or unsupported domain tools.
Mixed requests may process the supported part only through a validated scoped intent.
Unknown or unrelated requests get a fixed clarification or scope redirect.
Urgent stay/access concerns use existing support guidance without invented emergency advice or contact details.

An isolated classifier receives the current user message and a minimal server-built task summary.
Its schema uses closed scope/risk/intent reason codes and no freeform response text.
It receives no tools, listing descriptions, private financial data, secrets, or rejected-message history.
Its verdict is advisory. State, schema, principal, tenant, and action checks remain mandatory.
Classifier refusal, invalid JSON, unknown labels, timeout, or quota failure cannot fall through to unrestricted generation.
Perimeter checks precede classification. Existing authorized pending confirmations/cancellations retain their deterministic path without a classifier call.

### Tools and context

Every tool call must match the active pack, offered state, exact schema, permitted turn capability, and current principal's authorized references.
Reject unknown tool names, extra arguments, invalid types, fabricated dates, cross-guest references, and unavailable actions.
All consequential effects retain the existing command gate, confirmation binding, concurrency, and idempotency behavior.
No per-read approval prompt is required for authorized public inventory queries.

Only minimal public facts enter model tool results. External narrative remains untrusted tool data.
External strings cannot change instructions, schemas, capability lists, reply copy, destinations, or principal context.
Rejected scope/injection content and rejected model prose cannot re-enter subsequent model history or trusted summaries.
History filtering must preserve observable committed commands and valid guest continuity.
Guard diagnostics record reason codes, counts, and timings; they exclude prompts, replies, credentials, and private payment/identity material.

### Resource controls and evaluation

Reuse existing configurable pilot limits. Treat additional timeout, token, and size limits as documented configurable engineering settings.
Reserve model-request capacity before each actual provider request, including classifiers, retries, and fallbacks.
Use atomic persistent storage so restart and concurrency cannot reset or exceed the deployment/tenant and guest limits.
Do not treat a process-local counter as a deployment-wide or provider account spending ceiling.
Share quota authority through the platform storage/remote ports when the host separates objects.
Provider account caps remain a separate backstop. This implementation does not authorize changing account settings or deployment.
Quota or guard failure must preserve conventional guest workflows and valid deterministic pending decisions.

Adversarial tests must assert prohibited effects and truthful output, rather than refusal wording alone.
Evaluate benign completion, false refusal, attacks, guard outages, history contamination, concurrency, restarts, tokens, latency, and costs separately.
Retain failed live evidence. Use synthetic data and the existing approved key limit for paid evaluation.
Passing a finite evaluation does not establish complete prompt-injection resistance.

### Amendment (26 Oct 2026): one bounded scope-classifier retry

The default classifier path makes at most two attempts for one user message. A second attempt is made only when the first attempt returns a response that the classifier validator rejects with one of these closed codes: `invalid_json_trailing_text`, `invalid_json_multiple_values`, `invalid_json_syntax`, `invalid_json_unterminated`, `invalid_json_fenced`, or `invalid_json_wrapped`. Timeouts, transport failures, rate limits, quota or deadline refusals, truncation, prose, and any parsed verdict that the server rejects are not retried. A valid verdict of any scope, including `out_of_scope` or `policy_override`, is never re-asked.

Each attempt reserves model-request capacity immediately before its own provider request (this section extends the reservation rule above). A denied second reservation, or a second attempt stopped by its deadline or the guard, ends the classifier stage with the first failure's fail-closed outcome, so the first failure's existing codes and outcome stand. No reservation is refunded or replayed.

The second attempt uses the identical classifier request: the same system instruction, history, tools, structured output, and token limit. It contains no previous model output, no parse failure detail, and no guest text beyond the original request. Only its request timeout is smaller.

Classifier wall-clock budget: 8 seconds in total. The first attempt keeps the 5-second cap. A second attempt starts only if at least 2 seconds remain, and is capped at 3 seconds or the remaining budget, whichever is smaller. These values are configurable engineering settings under this ADR. The total must be at least the sum of the two attempt caps.

Diagnostics and telemetry record only closed codes and counts: the number of attempts started, the first attempt's closed failure code, and how the retry stage ended (recovered, not eligible, budget skipped, quota denied, or a second failure). A recovered retry is reported separately from the turn's single control outcome, which is still counted once. Evaluation reports keep the first failure visible even when the second attempt is valid, and a recovered retry does not by itself fail guard quality.

This amendment does not change the verdict's authority, tool gating, the fail-closed rule in the existing text above, or the approved model and provider defaults (ADR 0105).

## Constraints retained

ADRs 0015, 0068–0080, 0089, 0099, 0101, 0102, and 0105 remain in force.
No legal, processor, production, deployment, or real-payment approval is implied.
