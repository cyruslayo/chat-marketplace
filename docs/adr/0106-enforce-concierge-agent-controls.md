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

### Amendment (27 Oct 2026): guest date literals, dated clarification, and the turn wait

- Date authority. A date authorizes a classifier or planner role when the guest's own text states it as an ISO token or as an English day-month literal that resolves to that date (`date-literals.ts`): for example `20 November 2026`, `20 Nov`, `Fri 20 Nov`, `November 20, 2026`. A year-omitted literal resolves to the nearest on-or-after occurrence in Africa/Lagos, and only inside the 90-day booking horizon (ADR 0055, ADR 0092). Relative words, numeric slash forms, invalid or past dates, dates beyond the horizon, and weekdays that contradict the date stay unresolved. The planner's date must still equal a guest literal. A model-only date stays unauthorized.
- Structured dates. A check-in chosen with the date chip and confirmed by the guest becomes the assistant's server-owned date and a guest-authored fact. A pending relative phrase does not.
- Rejected planner dates. A date-authority rejection, or a planner date that fails the stay date rules, is a rejected tool call. The turn returns `ok: true` with a dated clarification, keeps the guest's message, commits no task state, and records `tool_denial`. It no longer returns `CONCIERGE_UNAVAILABLE`. The existing closed outcome list is unchanged.
- Turn wait. A server turn is bounded by the scope budget (8 s) plus four planner rounds, each able to make two provider attempts at 20 s (the primary and the one configured fallback): 168 s. The browser waits 188 s for the turn (20 s margin) and then reads the thread. It offers Retry only when the guest's message is not the thread's latest user entry. These are configurable engineering settings in `turn-budget.ts`. The turn wait is not a user-facing deadline, and the ADR 0079 commit boundary is unchanged.

### Amendment (27 Oct 2026): structured stay facts from the criteria chips

- Chip facts. The date chip and the guests chip are structured guest input. Beyond the confirmed check-in (see Structured dates above), the chip's nights and party size are guest-authored stay facts. The server records them in the assistant's task state so the next planner turn sees them and the persisted context keeps them.
- Derivation. A confirmed check-in with chip nights gives the checkout by the same night-count rule as the planner's search (`checkOutForNights`), and StayDateRange validates it (ADR 0023 length, ADR 0055 horizon). An invalid stay records neither nights nor checkout. The check-in itself is still recorded when it is confirmed.
- Authority. Nights and party size are not dates and carry no date authority. A planner date still needs guest text or a confirmed chip check-in. A model-proposed check-in is never recorded through this path, and a relative or unconfirmed chip date is not recorded.
- Projection. The persisted assistant context keeps only the fields it already held (city, neighbourhood, check-in, checkout, nights, party size and the other filters). No new record is persisted (ADR 0093 minimal projection, ADR 0099 and ADR 0101).

## Constraints retained

ADRs 0015, 0068–0080, 0089, 0099, 0101, 0102, and 0105 remain in force.
No legal, processor, production, deployment, or real-payment approval is implied.
