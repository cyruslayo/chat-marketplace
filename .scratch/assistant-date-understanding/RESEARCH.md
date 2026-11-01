# Research: why the concierge struggles with "next Friday", "next week", "next month"

Date: 1 Nov 2026. Status: research and proposal only. No code changed. Any change below to date authority needs an ADR 0106 amendment first (`docs/agents/domain.md`, "ADR conflicts").

## 1. Summary

The assistant's trouble with relative dates comes from the design, not the model. Three facts in the code explain it:

1. **The assistant path is built to refuse relative dates.** `apps/local-guest/src/assistant/date-literals.ts` resolves only ISO tokens and English day-month literals; "tomorrow", "Friday", "next week" are pinned to resolve to nothing (`test/assistant-date-literals.test.ts` "Date literal AC6"). The planner prompt says "If the user mentions a relative date, ask for an explicit YYYY-MM-DD date" (`shortlet-assistant-pack.ts:43`, pinned by `test/shortlet-assistant-evals.test.ts` Eval 18). The fallback reply is "Please give me the check-in date as YYYY-MM-DD." (`apps/web-agent/src/guest-content.ts:29`).
2. **Neither model is told what day it is.** The classifier `systemInstruction` (`scope-classifier.ts:79`) and the planner instruction (`ASSISTANT_PLATFORM_PREAMBLE` + `SHORTLET_PROMPT_SECTION`) contain no current date, weekday, time zone or horizon. A model asked to fill `checkIn` for "next Friday" can only guess. ADR 0106 then correctly rejects the guess, and the guest gets a clarification. The guest sees an assistant that "doesn't understand dates".
3. **The project already has the right pattern, on the other path.** The non-assistant concierge (`apps/local-guest/src/concierge.ts:272`, `relativeDates`) resolves today, tonight, tomorrow, weekdays, "next <weekday>", "this/next weekend" against the injected Lagos clock. It marks the result `given: false`, shows it back ("Just to check: arriving Fri 4 Sept 2026 and leaving Sun 6 Sept 2026 ..."), and searches only after the guest says yes (`test/guest-real-dates.test.ts` AC1, issue 01 of `guest-chat-first-ux`). The assistant path never calls it. "next week", "next month", "in two weeks" and "end of the month" are handled on neither path.

So the fix is to give the assistant path the same thing in a stronger form: **the model finds the phrase, deterministic code resolves it against the server clock, and the guest confirms the concrete dates.** ADR 0106 already allows that confirmation as an authority ("Structured dates": a chip check-in confirmed by the guest is a guest-authored fact; "A pending relative phrase does not" authorize). The amendment only has to say that a confirmed relative phrase counts too.

## 2. What current practice says

### 2.1 Let code do the date arithmetic

- **Rule-based normalizers still lead on temporal normalization.** HeidelTime (rule-based) was best at TempEval-3 normalization and is still reported as state of the art. Normalization works in two stages: a context-independent value ("next Friday" = the Friday of the following week) is anchored to a **reference date** later. Finding the right reference date is called the hardest part. ([ACL wiki: temporal normalisation SOTA](https://www.aclweb.org/aclwiki/Temporal_Expression_Recognition_and_Normalisation_(State_of_the_art)), [Automatic rule generation for time normalization](https://arxiv.org/pdf/2108.13658), [EventMiner slides](https://nlp.fi.muni.cz/trac/research//chrome/site/seminar2020/Eventminer2.pdf))
- **LLM-based normalization is competitive but needs anchoring.** In-context-learning normalizers are competitive with dedicated models across six domains and seven languages, but accuracy depends heavily on example choice and model size, and earlier LLM approaches needed a post-process to anchor expressions. A 2025 line of work has the LLM write *executable* normalization code (SCATE), and small distilled models beat their parents. ([Discourse-aware ICL for TE normalization, 2024](https://arxiv.org/html/2404.07775v1), [Generative LLMs for multilingual TE normalization](https://ebooks.iospress.nl/doi/10.3233/FAIA240940), [LLMs generating SCATE code](https://web3.arxiv.org/pdf/2507.06450))
- **Relative time is still a weak spot for LLMs.** TimE has an Extract task for relative expressions and finds them hard for LLMs. TReMu (ACL Findings 2025) targets relative time in multi-session dialogue and uses neuro-symbolic reasoning: the LLM writes code that computes the date instead of answering in prose. ([TimE](https://arxiv.org/html/2505.12891v2), [TReMu, neuro-symbolic temporal reasoning](https://aclanthology.org/2025.findings-acl.972.pdf))
- **Production parsers return a grain and candidate values, not one date.** Duckling resolves against an explicit reference time and returns a `grain` (day, week, month) and a `values` list, so "next week" is a week-grain interval, not a day. ([facebook/duckling](https://github.com/facebook/duckling)). TimeML/TIMEX3 has the same idea: underspecified values such as `2026-W46` or `2026-12` are allowed.

Takeaway: models are good at **finding** a temporal phrase and its role (check-in, checkout, duration). Code is better at **computing** the date. The output should keep its **grain** so "next month" is never collapsed into a guessed day.

### 2.2 Give the model a clock

- Practitioners put the **date** (not the second-level time) in the system prompt, so the prompt cache stays valid all day, and put the volatile local time and time zone in the per-turn context. They also expose a time tool for long sessions and define relative words in the prompt. ([Temporal context injection, Apr 2026](https://tianpan.co/blog/2026-04-20-temporal-context-injection-llm))
- Date tools for local models split date math into deterministic tools (now, add duration, diff, convert zone) and always return explicit offsets. ([LM Studio date-tools](https://lmstudio.ai/npacker/date-tools))

For this project: Africa/Lagos has no daylight saving, and a turn never crosses a pricing boundary mid-call, so one line "Today is Sunday 1 November 2026 (Africa/Lagos). Bookable check-ins run to 30 January 2027." per turn is enough. It lets the classifier reason about "next Friday" without granting it any authority.

### 2.3 Domain agents: the model interprets, deterministic code owns the rules

- **Rasa CALM**: an LLM "command generator" turns the user's message into structured commands (set slot, start flow, cancel). A deterministic flow engine runs the business logic. Each slot has a `validate_<slot>` action. Built-in "conversation repair" patterns handle clarification and correction. ([Rasa flow policy](https://rasa.com/docs/rasa-pro/concepts/policies/flow-policy/), [Business logic with flows](https://www.rasa.com/docs/reference/primitives/flows), [Writing flows](https://rasa.com/docs/pro/build/writing-flows))
- **Bounded patterns win in production**: tool use with guardrails, plan-then-execute with checkpoints, human confirmation only at named decisions. Schema-validated output, with validation errors fed back to the agent for self-correction. A non-LLM rule component enforces hard constraints. ([Agentic design patterns 2026](https://www.sitepoint.com/the-definitive-guide-to-agentic-design-patterns-in-2026/), [Context engineering](https://slavadubrov.github.io/blog/2025/10/05/context-engineering-in-the-agenticai-era--and-how-to-cook-it))
- **Tool design ("poka-yoke")**: change the tool's arguments so the wrong call is impossible, not just discouraged. ([Anthropic, Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents), [agentpatterns.ai: poka-yoke for agent tools](https://agentpatterns.ai/tool-engineering/poka-yoke-agent-tools/)). Here: asking the planner for `checkIn: YYYY-MM-DD` invites it to compute a date it has no clock for. Asking it for the guest's verbatim phrase removes the failure.
- **Measure consistency, not one lucky run**: τ-bench grades agents on whether the final database state matches the goal while they follow a written domain policy, and reports **pass^k** (all k attempts succeed). Strong models fell below 25% at pass^8 in retail. ([τ-bench overview](https://futureagi.com/blog/tau-bench-explained/), [tau2-bench](https://evalscope.readthedocs.io/en/latest/third_party/tau2_bench.html)). A live date eval for this concierge should repeat each phrase k times.

The project already follows most of this (ADR 0106: closed tool schemas, server-owned facts, `tool_denial` as a rejected call, closed diagnostics). The date path is the one place where the model is asked to do the arithmetic and is then punished for it.

## 3. ADR table

| ADR | Constraint | What it means for this work |
|---|---|---|
| 0106 (and 27 Oct amendment) | A date authorizes a role only from guest text (ISO or English day-month literal), prior guest text, or confirmed structured input. Relative words stay unresolved. Model-only dates never authorize. Rejected dates are `tool_denial` with a dated clarification. No deterministic in-scope fast path around the model. | **Conflict:** resolving relative phrases changes "Relative words ... stay unresolved". Needs an amendment: a relative phrase the guest typed, resolved by server code and **confirmed by the guest**, becomes a guest-authored date, like a confirmed chip check-in. An unconfirmed resolution still authorizes nothing. The resolver is not a fast path: it runs on the span the model or classifier found, inside the normal turn. |
| 0092 | Extended stays, billing periods from check-in. | A resolved "next month" with a month-long stay must still pass `StayDateRange` and the extended-stay policy. |
| 0055, 0023 (as amended 1 Nov 2026) | 90-day booking horizon; Short Stay length limits. | The resolver drops candidates beyond the horizon or in the past. "In four months" resolves to nothing and gets the existing horizon copy. |
| 0041, 0042 | Operator Active Hours and the same-day cutoff. | "Tonight" or "today" after the cutoff resolves but the submit is refused by policy. The show-back should say so, not search silently. |
| 0075 | Closed diagnostics, no guest text in logs. | New outcome detail (for example `relative_date_pending`) must be a closed code. Never log the phrase. |

## 4. Proposal

### 4.1 One shared resolver with a typed result

Merge `concierge.ts relativeDates` and `date-literals.ts` into one module (for example `domains/shortlet/src/stay-date-expressions.ts` or the assistant folder), returning a typed resolution, never a bare string:

```ts
type DateResolution =
  | { kind: "day"; date: string; source: "literal" | "relative" }          // "20 Nov", "tomorrow", "next Friday"
  | { kind: "range"; earliest: string; latest: string; grain: "weekend" | "week" | "month" } // "next week", "next month"
  | { kind: "ambiguous"; candidates: readonly string[] }                    // "next Friday" said on a Wednesday
  | { kind: "unresolved"; reason: "past" | "beyond_horizon" | "unknown" }; // "Sallah", "in 5 months"
```

Inputs: the phrase, the injected clock (`dateKeyInLagos`), and a policy object (week start, "next <weekday>" rule, horizon) passed in, not hardcoded (AGENTS.md anti-pattern 3).

Coverage, by priority (from guest phrasing seen in tests and Nigerian English):

| Phrase | Resolution (reference Sun 1 Nov 2026) |
|---|---|
| today, tonight | day 2026-11-01 |
| tomorrow | day 2026-11-02 |
| next tomorrow (Nigerian English: the day after tomorrow) | day 2026-11-03 |
| Friday, this Friday | day 2026-11-06 |
| next Friday | ambiguous on Wed to Sat (this week's Friday vs the week after); on Sun to Tue, the existing rule gives 2026-11-06 |
| this weekend / next weekend | range Fri to Sun (existing rule) |
| next week | range 2026-11-02 to 2026-11-08, grain week |
| in two weeks, in 10 days | day (two weeks: 2026-11-15) |
| next month | range 2026-12-01 to 2026-12-31, grain month |
| end of the month, mid-December, first week of December | range |
| Christmas, New Year's Eve | day (fixed dates) |
| Sallah, Eid, Easter | unresolved (moving dates; ask) |

### 4.2 Model finds the phrase, code computes the date

- Add a `dateExpression` (and optional `checkOutExpression`) string to the classifier slots and the `search_stays` schema: "the guest's words for the arrival, copied exactly". Keep `checkIn` for ISO and literal dates.
- Server check: the expression must be a substring of the current or prior guest text (the same provenance test as `containsExactDateToken`). A paraphrase fails closed as `tool_denial`.
- The server resolves it with 4.1. The model never supplies the computed date.

### 4.3 Confirm, then search (reuse issue 01)

- `day`: show back "Arriving Fri 6 Nov 2026, leaving Mon 9 Nov 2026 (3 nights), 2 guests. Shall I search these dates?" with **Yes** and **Change dates** chips. Only the yes makes the date guest-authored (same rule as a confirmed chip check-in). Cold restore must keep the pending resolution, keyed by its own persisted id, and a forged or stale confirm fails closed.
- `ambiguous`: one tap, not a typed date. "Do you mean Fri 6 Nov or Fri 13 Nov?" as two chips.
- `range`: ask for the day inside the range, with the date chip opened at `earliest`, or day chips for a week. Never pick a day for the guest. If nights are also missing, ask once for both.
- `unresolved`: the existing dated clarification, but in plain words ("Which date is that? For example 20 November"), not "YYYY-MM-DD". Retire `dateClarification`'s YYYY-MM-DD copy and the keyword regex at `shortlet-assistant-pack.ts:958`, which is itself a keyword path that ADR 0106 discourages.

### 4.4 Give both models the date

Prepend one line per turn to the classifier and planner context: today's date and weekday in Africa/Lagos and the last bookable check-in date. It improves which span is picked and the role binding (check-in vs checkout). It grants nothing; authority still comes from 4.2 and 4.3.

### 4.5 Evals

- **Deterministic matrix** (unit, fast): every phrase in 4.1 times seven reference weekdays, a month end, a year end (31 Dec), the horizon edge, and the 10:55 WAT same-day cutoff.
- **Assistant journeys** (per AGENTS.md "Concierge assistant path"): assistant enabled, cold restore before every event, clock 2026-10-27, guest with no phone or email. Cases: "next Friday" then Yes; "next week for 3 nights" then a day chip; "next month" then the date chip; a forged confirm id returns `STALE_SURFACE`; "change dates" after the show-back.
- **Live consistency**: each phrase k = 5 times against the staging model, scored by pass^k on the closed `assistant.control.outcome.v1` outcomes. Run only with owner approval.
- Rewrite the tests that pin the current behaviour: `assistant-date-literals.test.ts` AC6 (relative words now resolve to a *pending* value but still authorize nothing on their own) and `shortlet-assistant-evals.test.ts` Eval 18 and line 95.

## 5. Suggested issues (not filed yet)

1. **ADR 0106 amendment: confirmed relative dates.** Human decision. Also decide the "next <weekday>" rule and whether "next tomorrow" is supported.
2. **Shared date-expression resolver with typed grain** (4.1), with the unit matrix. Replaces `relativeDates` in `concierge.ts`, so both paths behave the same.
3. **Assistant phrase extraction and confirmation** (4.2, 4.3), with cold-restore journey tests.
4. **Clock line in the classifier and planner context** (4.4).
5. **Plain-word date clarification copy** (4.3, last point).

Order: 1, then 2 and 4 in parallel, then 3, then 5.

## 6. Appendix: what the non-assistant concierge does that the assistant path does not use

When the assistant runtime is on, `LocalGuestApp.#handleTurn` (`apps/local-guest/src/shortlet-app.ts:910`) sends every turn to it. Everything after line 925 runs only when the assistant is off or its provider is unavailable. The assistant imports one helper from `concierge.ts` (`searchAreaFor`). Found by reading the code and grepping; items marked (verify) need a test before building on them.

| # | Non-assistant behaviour (where) | Assistant path today |
|---|---|---|
| 1 | Relative dates resolved on the Lagos clock, shown back, searched only after "yes" (`concierge.ts:272`, issue 01) | Refused; asks for YYYY-MM-DD |
| 2 | Date ranges "20 Nov to 23 Nov" give check-in and checkout (`concierge.ts` given dates) | Classifier `checkOut` slot is only used to reject; `search_stays` has no checkout; the model must compute `nights`, with no check against the guest's checkout |
| 3 | Budget parsing: ₦, k, m, naira, per night vs per stay, small numbers are not money (`extractBudget`, issue 03b) | `maxBudgetKobo` "all-in" only; the model converts naira to kobo and multiplies per-night prices itself; no provenance check |
| 4 | Amenity words to catalogue ids, including Nigerian "light" for power (`AMENITY_QUESTIONS`) | `requiredAmenities` is free text; an id the catalogue does not use gives zero results silently (`browse.ts:469`) |
| 5 | Location aliases and a location-change question before searching (`LOCATION_PATTERNS`, `pendingLocationChange`) | `normalizeNeighbourhood` passes unknown names through; no change question |
| 6 | Unfilterable preferences acknowledged (gym, kitchen, balcony; issue 02 AC3) | No equivalent |
| 7 | Asking order where, who, when, nights, with quick-reply chips (`quickRepliesFor`, issue 11 AC3) | Fixed clarification sentence, no quick replies |
| 8 | "Show me the apartment", "the last one" opens a result (`viewResultIntent`, issue 10 C4) | Left to the model (verify) |
| 9 | An unrelated turn keeps the current results | Left to the model (verify) |
| 10 | Facility questions answered from `unit.amenities`, with "isn't listed, so I can't confirm" (issue 04a AC2) | Details reply lists amenities; no per-question honest "not listed" answer |
| 11 | Change requests after submission explained (`#changeExplanation`, ADR 0005, 0060) | No equivalent copy found |
| 12 | Draft revision from chat, with the relative-date confirm (`#proposeDraftReplacement`, issue 14) | No equivalent found (verify) |
| 13 | Stage-aware capability replies (`#capabilityReply`) | No equivalent found |

Also on the assistant path: the request summary falls back to `nights ?? 3` and `partySize ?? 1` (`shortlet-assistant-pack.ts:730`), which shows the guest made-up values, against the "never default" rule in the same file. A third, older model path (`gemini-concierge.ts`) only runs without the assistant runtime.

**How to connect them without a keyword fast path (ADR 0106).** Don't route around the model. Use the deterministic code as the server-side normalizer and validator of what the model returns:

- Dates and budget: the model passes the guest's own words; the server parses them with the shared resolver and `extractBudget`, then shows back what it understood.
- Amenities and areas: closed enums in the tool schema, built from the catalogue and `SEARCH_AREAS`, so a wrong value cannot be sent.
- Checkout: accept a checkout phrase and derive nights on the server.
- Show-back, quick replies, the unsupported-preference note, honest amenity answers and the change explanations become reply-plan outputs the runtime renders from the same helpers as the non-assistant path.
