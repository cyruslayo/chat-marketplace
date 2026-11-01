# PRD: Connect the deterministic concierge to the assistant concierge

Status: needs-triage
Requested: 1 Nov 2026
Research: [../assistant-date-understanding/RESEARCH.md](../assistant-date-understanding/RESEARCH.md)

## Problem

The guest app has two concierges that do not share their understanding of guest text.

- **Deterministic concierge** (`apps/local-guest/src/concierge.ts` and the free-text part of `LocalGuestApp.#handleTurn`, `apps/local-guest/src/shortlet-app.ts:925` onward). It resolves relative dates and confirms them, parses budgets, maps amenity and area words, asks for criteria in order with chips, answers facility questions from the listing, explains why a sent request cannot change, and revises a draft from chat.
- **Assistant concierge** (`apps/local-guest/src/assistant/`, ADR 0106). When it is on, every free-text turn goes to it (`shortlet-app.ts:910`). The deterministic free-text code runs only when the assistant is off or its provider is unavailable. The assistant imports one helper from `concierge.ts` (`searchAreaFor`).

So the product's live path is missing behaviour the project already built and tested. Guests see "Please give me the check-in date as YYYY-MM-DD", budgets and amenities that silently return nothing, and no way to change a draft by chat.

Events (chips, View, Request to Book, Submit, Accept, payment) already go through shared handlers, and the chip facts are synced into the assistant (`#recordAssistantStayChip`). The gap is free text, plus one chip (budget).

## Goal

Every guest-text capability of the deterministic concierge is available on the assistant path, with the same result for the same input, without a keyword fast path around the model (ADR 0106).

## Approach (the rule for every issue)

The model interprets; the server computes and validates.

1. The model returns the guest's own words for a fact (date phrase, budget phrase) or a value from a closed list (area, amenity).
2. The shortlet pack checks the words are in the guest's text, then normalizes them with the deterministic code (`concierge.ts` helpers, moved behind one shared module where both paths call it).
3. Anything resolved rather than typed exactly is shown back and confirmed before it is searched, as issue 01 of `guest-chat-first-ux` does.
4. Replies use the same helper and copy as the deterministic path (ADR 0077, 0080).

Domain logic stays in the shortlet pack or the shortlet domain, never in the domain-neutral runtime (ADR 0099; see commit b0d40ee).

## ADRs

| ADR | Constraint | Where it applies |
|---|---|---|
| 0106 | Date authority fails closed; rejected tool calls are `tool_denial` with a clarification; no deterministic in-scope fast path; cold restore keeps every guest-held id | Issues 01, 04, 05, 06, 07, 13 |
| 0080 | Deterministic parity for critical workflows; no agent-only contract | All: both paths give the same result |
| 0099 | Runtime is domain-neutral; packs declare tools, prompt and replies | Where code lives (all) |
| 0077 | One canonical artifact and vocabulary across channels (`guest-content.ts`) | Copy in 09, 10, 11, 12 |
| 0074 | Generative surfaces have a fail-closed lifecycle | Pending confirmations in 04, 13 |
| 0072 | Consequential actions through the platform action gate | Draft revision accept in 13 |
| 0015 | All-in pricing | Budget semantics in 06, 07 |
| 0023 (amended 1 Nov 2026), 0092, 0055 | Stay lengths, extended stays, 90-day horizon | Date resolution in 02, 04, 05 |
| 0005, 0060 | A Booking Request is not a Reservation; amendments are versioned | Change explanations in 12 |
| 0075 | Closed diagnostics; no guest text in logs | Any new outcome code |
| 0078 | Accessible launch profile, 44px targets | Chips in 04, 10 |

## Out of scope

Commerce (`COMMERCE_ENABLED` stays off). New booking policy. Changing the 90-day horizon or the 119-day trust-field rule.
