# Shortlet Guest Assistant v1 — Architecture, Protocol & Verification Guide

## 1. Overview & Provider Neutrality

The **Shortlet Guest Assistant v1** is a task-oriented conversational assistant embedded within the Shortlet concierge architecture (pps/local-guest/). Unlike simple regex parsers, the assistant manages working state across multi-turn dialogs, coordinates tool loops, presents structured discovery surfaces, and enforces safe, two-phase confirmation for consequential platform commands.

The system is designed with strict **provider neutrality**:
- The core runtime (AssistantRuntime) communicates exclusively through the AssistantModelClient interface.
- An offline deterministic model (ScriptedAssistantModel) executes multi-turn tool loops, clarifies ambiguity, and issues proposals completely offline with zero network latency and zero Gemini API quota usage.
- The real provider adapter (GeminiInteractionsClient) targets Google’s @google/genai Interactions API (i.interactions.create) with store: false, structured tool declarations, and system instruction constraints.

---

## 2. Calendar Anchors & Date Provenance

- **Calendar Anchor**: September 2026 (ixture clock: 2026-09-03T10:00:00Z).
- **Standard Demo Dates**: Check-in 2026-09-10, check-out 2026-09-13 (3 nights) or 2026-09-15 (5 nights).
- **Date Provenance Rule**: The model is forbidden from inventing, hallucinating, or assuming arbitrary check-in dates. If a guest does not provide an explicit check-in date (or says relative dates such as  next Friday), the assistant either falls back to the deterministic demo window or asks the guest for the check-in and checkout dates in plain words. If a model attempts to execute a search with dates not authored or anchored by the user/fixture, the tool layer fails closed (CONCIERGE_UNAVAILABLE).

---

## 3. Two-Phase Consequential Actions (Human-in-the-Loop)

Consequential lifecycle commands:
1. **Request to Book** (ooking_request.submit)
2. **Accept Offer** (conditional_offer.accept)
3. **Start Payment / Checkout** (ooking_contract.fulfill_card_payment)

These actions can **NEVER** be executed in a single shot by LLM tool calls. The protocol mandates a strict two-phase flow:
1. **Proposal Phase**: The model calls a proposal tool (propose_request_to_book, propose_accept_offer, or propose_start_payment). The runtime generates an opaque, cryptographically random PendingAssistantAction (pa-<uuid>) stored in the server-owned working state and mounts an authoritative Weaver A2UI Confirmation Card with explicit all-in price breakdowns and [Confirm] / [Cancel] buttons.
2. **Confirmation Phase**: Execution occurs **ONLY** after explicit affirmation:
   - Clicking Weaver [Confirm] button (shortlet.assistant.confirm-action event), or
   - Explicit conversational affirmation (yes, confirm, proceed, do it).
   - Ambiguous messages (maybe, looks good, cool) fail closed and do not execute.
   - Replayed, duplicate, or stale confirmations fail closed with STALE_SURFACE.

---

## 4. Working State & Bounded Tool Loops

The assistant maintains server-owned working memory per conversation thread (AssistantThreadState):
- 	askState.shortlist: Opaque stay references (stay-1, stay-2) mapping to underlying unit IDs, preventing guest exposure to internal database primary keys.
- 	askState.pendingAction: Unexecuted consequential action with expiration and transactionality.
- 	askState.currentBookingRequestId, currentOfferId, currentContractId: Active lifecycle platform references.
- **Transactional Rollback**: Every conversational turn clones the thread state prior to execution. Any provider error or unexpected failure restores the pre-turn snapshot, guaranteeing no corrupted working state or ghost bookings.
- **Bounded Loops**: The tool execution loop enforces a strict limit of 4 rounds per turn, preventing infinite tool chaining.

---

## 5. Verification & Test Architecture

1. **Protocol Tests (	est/assistant-interactions-protocol.test.ts)**:
   - Validates @google/genai payload structures, tool call representations, function response mapping, and missing-key failure modes without invoking live network connections.
2. **20 Offline Eval Scenarios (	est/shortlet-assistant-evals.test.ts)**:
   - **Eval 1**: Full search criteria produces discovery surface with all-in pricing.
   - **Eval 2**: Missing nights/guests triggers clarification.
   - **Eval 3**: Answering clarification completes the search.
   - **Eval 4**: Follow-up resolution (tell me about the first one) fetches unit details.
   - **Eval 5**: Search refinement (actually Lekki) updates discovery results.
   - **Eval 6**: Side-by-side comparison using authoritative facts.
   - **Eval 7**: Transparent pricing breakdown and security deposit explanation.
   - **Eval 8**: Request-to-book generates pending action card.
   - **Eval 9**: Ambiguous confirmation fails closed.
   - **Eval 10**: Conversational yes confirms and issues request.
   - **Eval 11**: Weaver Confirm button executes booking request.
   - **Eval 12**: Duplicate / racing confirmation fails closed (STALE_SURFACE).
   - **Eval 13**: Conversational offer acceptance flow.
   - **Eval 14**: Conversational payment checkout flow.
   - **Eval 15**: Platform status check (Am I booked?) returns authoritative state.
   - **Eval 16**: Adversarial injection treated strictly as data.
   - **Eval 17**: Date provenance rejects fabricated dates.
   - **Eval 18**: Relative date next Friday requests explicit date.
   - **Eval 19**: Transactional rollback on provider failure.
   - **Eval 20**: Explicit cancellation cleans up pending actions.

---

## 6. How the Developer Runs the Final Live Gemini Smoke Test

> [!IMPORTANT]
> Live Gemini API smoke was intentionally **NOT run** during implementation or automated testing.

After all preflight checks pass, the human developer can execute the live smoke test:

1. Obtain a Google Gemini API Key.
2. Run in terminal:
`ash
=your-api-key-here
=1
npm run assistant:live-smoke
`

Or start the full local guest concierge in live Gemini mode:
`ash
=your-api-key-here
=gemini
npm run guest:local
`
Navigate to http://localhost:3001 and interact with the live assistant.

## Terse follow-up cases (issue 61)

Every offline test scripts the classifier verdict, so the live model's own reading of a terse answer is measured separately (ADR 0106: false refusals are evaluated separately). The offline cases in `test/assistant-terse-followups.test.ts` cover every row below, warm and cold; each asserts the classifier request's `openQuestion` code and the committed fact or next step.

| Open question | Guest text | Expected fact |
|---|---|---|
| party_size | "just me" / "2" / "two of us" / "me and my wife" | partySize 1 / 2 / 2 / 2 |
| nights | "a week" / "3" | nights 7 / 3 |
| pick_result | "the first one" / "the second" | opens result 1 / 2 |
| date_confirm | "yes" | check-in confirmed |
| where | "Wuse 2" | Abuja, Wuse 2 |

A case whose verdict comes back `unclear` falls back to the issue 59 re-ask (the fixed question plus its chips), never the generic `unavailable` copy.

### Owner live run

Agents never run the live eval: it calls a real provider and needs the key. The same rows live in `scripts/pilot-agent-smoke.ts` (via `scripts/pilot-agent-smoke-terse.ts`) and are reported in `.scratch/pilot-agent-smoke/agent-smoke-report.md` as closed codes only (scope, reason, the code sent, pass/fail) plus a false-refusal rate. The report carries no guest or model text.

The owner runs it with `LLM_API_KEY` set for that command only (do not paste keys into shell history you share, and never print the environment). Every other command in this doc uses `env -u LLM_API_KEY`. The OpenRouter configuration:

```
CONCIERGE_MODE=openai-compatible \
LLM_BASE_URL=https://openrouter.ai/api/v1 \
LLM_MODEL=openai/gpt-6-luna \
LLM_PROVIDER_LABEL=openrouter \
LLM_API_KEY=…(owner-supplied)… \
npm run pilot:local:agent-smoke
```

Then record the false-refusal rate in issue 61's Comments. Target on `openai/gpt-6-luna`: no false refusals across the cases.