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
- Structured dates. A check-in chosen with the date chip and confirmed by the guest becomes the assistant's server-owned date and a guest-authored fact. A pending relative phrase does not (see the 2 Nov 2026 amendment for confirmed date phrases).
- Rejected planner dates. A date-authority rejection, or a planner date that fails the stay date rules, is a rejected tool call. The turn returns `ok: true` with a dated clarification, keeps the guest's message, commits no task state, and records `tool_denial`. It no longer returns `CONCIERGE_UNAVAILABLE`. The existing closed outcome list is unchanged.
- Turn wait. A server turn is bounded by the scope budget (8 s) plus four planner rounds, each able to make two provider attempts at 20 s (the primary and the one configured fallback): 168 s. The browser waits 188 s for the turn (20 s margin) and then reads the thread. It offers Retry only when the guest's message is not the thread's latest user entry. These are configurable engineering settings in `turn-budget.ts`. The turn wait is not a user-facing deadline, and the ADR 0079 commit boundary is unchanged.

### Amendment (27 Oct 2026): structured stay facts from the criteria chips

- Chip facts. The date chip and the guests chip are structured guest input. Beyond the confirmed check-in (see Structured dates above), the chip's nights and party size are guest-authored stay facts. The server records them in the assistant's task state so the next planner turn sees them and the persisted context keeps them.
- Stated length (8 Nov 2026, issue 19). A stay length the guest typed (nights, weeks or months) is a guest-authored stay fact, as chip nights are. A month is 30 nights (ADR 0092).
- Derivation. A confirmed check-in with chip nights gives the checkout by the same night-count rule as the planner's search (`checkOutForNights`), and StayDateRange validates it (ADR 0023 length, ADR 0055 horizon). An invalid stay records neither nights nor checkout. The check-in itself is still recorded when it is confirmed.
- Authority. Nights and party size are not dates and carry no date authority. A planner date still needs guest text or a confirmed chip check-in. A model-proposed check-in is never recorded through this path, and a relative or unconfirmed chip date is not recorded.
- Projection. The persisted assistant context keeps only the fields it already held (city, neighbourhood, check-in, checkout, nights, party size and the other filters). No new record is persisted (ADR 0093 minimal projection, ADR 0099 and ADR 0101).
- Amendment (8 Nov 2026, issue 19): Projection. The persisted assistant context also keeps the guest's stated stay length (nights, and the unit and count the guest used), set only from guest text, a chip edit or guest dates, so it survives cold restores; no other field is added.

### Amendment (2 Nov 2026): confirmed date phrases are guest-authored

Owner decision of 2 Nov 2026 on issue 01 (`.scratch/assistant-concierge-parity/issues/01-amend-adr-0106-for-confirmed-guest-phrases.md`). Decisions 1 to 6 are accepted as recorded below.

- Confirmed date phrase (decision 1). A date phrase the guest typed (for example "tomorrow", "next Friday", "25 Dec") that server code resolves against the Africa/Lagos clock, and that the guest then confirms on a show-back, is a guest-authored check-in, as a confirmed chip check-in is. Before that confirmation the resolution is server output, not guest text, and authorizes nothing.
- Authority. Authority comes only from the guest's confirmation of the show-back, never from the model or the classifier. An unconfirmed or ambiguous resolution authorizes nothing. The planner's date must still equal the confirmed date. The 27 Oct statement that relative words stay unresolved applies to unconfirmed phrases only.
- Confirmation is structured guest input. A guest "yes" to the show-back, or a tap on its chip, is recorded in the assistant task state and persists across a cold restore. The restore re-keys the persisted ids and never re-mints them (the cold-restore rule in AGENTS.md, "Concierge assistant path").
- Ambiguous "next <weekday>" (decision 2). From Monday to Saturday, "next <weekday>" is ambiguous: the show-back offers both candidate dates as chips and authorizes neither until the guest taps one. On Sunday only, the rule applies: that weekday in the following Monday-start week. This supersedes the "Wed to Sat" wording of issue 01's original decision 2.
- Week start (decision 3). Weeks start on Monday, for "next week" and every other span.
- "Next tomorrow" (decision 4). Nigerian English "next tomorrow" means the day after tomorrow.
- Holidays (decision 5). Fixed holidays resolve: 25 December and 31 December. Moving holidays (Sallah, Eid, Easter) never resolve.
- Spans (decision 6). "Next week", "next month" and "end of the month" never become a single day without a guest choice. The resolver returns a range with its grain, and the guest picks the day from day chips or the date chip, opened at the start of the range.
- Configuration (AC2). The rule values are configuration, not literals in code. The date resolver takes one policy object with these defaults: week start Monday; the "next <weekday>" rule above; the fixed holiday list (25 December, 31 December); and the Booking Horizon of 90 days (ADR 0055). The resolver and the shortlet pack contain no literal values for them. The literals now in `concierge.ts` `relativeDates` move into this policy object in issue 02.
- Boundaries. A resolved date beyond the Booking Horizon (ADR 0055) authorizes nothing. ISO tokens, English day-month literals and chip dates are unchanged. A rejected planner call remains a `tool_denial` (27 Oct amendment). No deterministic in-scope fast path is added: the model returns the guest's words, and the server resolves and shows them back. The confirmation is guest input, so the agent still makes no state transition (ADR 0080).

### Amendment (8 Nov 2026): booking-change intents

- Closed intents. `CONCIERGE_INTENTS` gains `end_booking` (a guest asks to end a stay early, giving notice) and `extend_booking` (a guest asks to stay longer). Both are closed labels in the scope classifier schema and validator, and nothing else in the list changes.
- Mapping. `end_booking` maps only to the preview-only planner tool `propose_notice_to_end`. `extend_booking` maps only to the preview-only planner tool `propose_extension`. Each tool records nothing by itself. Its card is confirmed by the card's button only: `give_notice` and `request_extension` are not on the text-confirmation allow-list (ADR 0074), so a typed "yes", "ok", "confirm" or "go ahead" never executes them.
- Support. The `support` intent offers neither tool. A support request such as a water or access problem never produces a notice or extension card.
- Warm session runtime. A session's assistant runtime is not rebuilt between requests, so it adopts the shell's booking references (the draft, request, offer, reservation and contract the guest's thread holds) on every entry point (`getState`, `handleTurn`, `handleEvent`, `handleEventAsync`), with the same derivation a cold restore uses. History, surfaces and the pending action are kept. The offer-gated tools therefore see the same current offer on a warm and a cold runtime. The tool gates themselves are unchanged.

### Amendment (8 Nov 2026, issue 20): a clarification keeps the guest's own facts

A clarification turn still runs no search and no tool effect, and keeps nothing the model proposed. It saves the stay facts the guest's own words give (the area, a typed check-in or a typed stay with its checkout that the date rules accept, the stated length, party size and bedrooms) into the persisted assistant context, which may be partial (no area), so the next turn can use them after a cold restore. No other field is added.

## Constraints retained

ADRs 0015, 0068–0080, 0089, 0099, 0101, 0102, and 0105 remain in force.
No legal, processor, production, deployment, or real-payment approval is implied.
