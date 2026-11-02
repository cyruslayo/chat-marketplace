# Assistant: take the guest's checkout and derive the nights on the server

Status: needs-triage
Type: AFK
Blocked by: 02
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

The deterministic path reads "20 Nov to 23 Nov" as a check-in and a checkout (`concierge.ts`, `given: true`). On the assistant path `search_stays` has no checkout argument (`shortlet-assistant-pack.ts:58-79`); the model must count the nights itself, and the classifier's `checkOut` slot is only used to reject (`date-tokens.ts currentTurnDateRoles`, `shortlet-assistant-pack.ts:349,375`). Nothing checks the model's nights against the guest's checkout.

## What to build

- `search_stays` accepts an optional `checkOut` (ISO or literal the guest wrote, same authority as `checkIn`) or `checkOutPhrase` (resolved as in issue 04).
- When the guest gave a checkout, the server derives nights from it; a model `nights` that disagrees is a `tool_denial` with the dates clarification.
- The derived stay is validated by `StayDateRange` (ADR 0023, 0092, 0055).

## Acceptance criteria

- [ ] AC1: "Ikoyi 20 Nov to 23 Nov for 2" searches 2026-11-20 to 2026-11-23 (3 nights) with no nights from the model.
- [ ] AC2 failure path: a model `nights` that contradicts the guest's checkout is a `tool_denial` and runs no search.
- [ ] AC3 failure path: a checkout before or equal to the check-in, or beyond the stay limits, is a `tool_denial` with the existing limit copy.
- [ ] AC4: Same input gives the same filters on the deterministic path and the assistant path (parity test).
- [ ] AC5: Runs with the assistant enabled and a cold restore before every event.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0106 | Date authority; rejected calls are `tool_denial` | AC2, AC3 |
| 0023, 0092, 0055 | Stay length and horizon | AC3 |
| 0080 | Parity | AC4 |

## Comments

### Triage note (agent, 2 Nov 2026)

**1. Blockers.** 02 (shared resolver, commit 58842ee) is resolved. The `Blocked by: 02` line is right for AC1 to AC5 as literal dates. The `checkOutPhrase` part of What to build needs 04 (its phrase helper and show-back), which the file does not list. Add 04 to the blockers for that part, or split it out (see 4).

**2. What is delivered, and what is missing.**

Delivered:
- Nights and checkout derivation, with StayDateRange: `checkOutForNights` (`apps/local-guest/src/assistant/shortlet-assistant-pack.ts:402`) and `validatedCheckOutForNights` (:412). The search branch derives the checkout from the planner's nights and validates it (:584 to :588). The deterministic path does the reverse and takes the nights from a typed checkout (`apps/local-guest/src/concierge.ts:366` to :369).
- Checkout role binding for guest text: `currentTurnDateRoles` binds the classifier's checkIn and checkOut slots when the guest wrote those dates (`date-tokens.ts`). `isDateGovernedByCheckOut` decides role with `CHECKOUT_KEYWORD` (`date-tokens.ts:38`, "check out" or "checkout" only).
- Literal parsing, probed read-only on the staging clock: "Ikoyi 20 Nov to 23 Nov for 2" gives two separate `day` literals, 20 Nov and 23 Nov, with no pair. "10-13 Nov" gives one `day` with `endDate` 13 Nov. `date-literals.ts` keeps only single days, so the pair is not authorized as a stay today.

Missing:
- `search_stays` has no `checkOut` property (`shortlet-assistant-pack.ts:66` to :88, `additionalProperties: false`). The planner cannot send one, so AC1 ("no nights from the model") cannot be met today.
- Checkout binding without a check-in is refused: `resolveCheckInDate` throws "A checkout date cannot authorize a new check-in date" (pack :447 and :473). A pair "20 Nov to 23 Nov" must be bound as one stay, not as two days.
- No nights-disagreement check (AC2). The planner's nights are used to derive the checkout (:584 to :586). Nothing compares them with a checkout the guest typed.
- Parity (AC4): the assistant path has no checkout input, so the filters cannot match the deterministic path yet.
- No cold-restore test for checkout (AC5).

**3. Owner questions and risks.**

a. **Pair rule.** Does "A to B" (or "A-B") bind B as the checkout on the assistant path? The deterministic path does, through `stayRequestDates` (concierge.ts). The assistant path can bind B only if the classifier returns it as `checkOut` and `containsGuestDate` finds B in the text, and the keyword rule (`CHECKOUT_KEYWORD`) does not apply. ADR 0106 (27 Oct and 2 Nov) does not say how pairs bind. Owner: add a pair rule to the date-authority amendment, or require the word "checkout".

b. **Literal stay pair.** `date-literals.ts` deliberately drops `endDate` ("a literal stay is not one typed day, so it authorizes nothing here"). AC1 needs a literal pair to authorize two dates. Owner: does a typed stay pair authorize check-in and checkout on the assistant path? This is the same question as (a), and it decides the authority model.

c. **Keyword role binding.** `CHECKOUT_KEYWORD` (`date-tokens.ts:38`) decides whether a date is a check-in or a checkout from a regex over guest text. It is existing 27 Oct behaviour, not new. It conflicts with the RULES against keyword shortcuts. Owner: keep it, or replace it with the resolver's spans (`span.start`/`span.end` already exist on each resolution).

d. **Checkout phrases.** "until next Monday" (`checkOutPhrase`) needs the 04 show-back and must show both dates and the nights before the search (2 Nov: a confirmed phrase is guest input). This is the 04 flow with a second date.

e. **Limits copy.** AC3 must reuse the existing stay-limit copy from the deterministic path (`dateLimitRefusal` in concierge.ts, named in the 02 ADR table). Confirm it is in `guest-content.ts` (ADR 0077) before the assistant path reuses it.

f. **Nights mismatch copy.** AC2's `tool_denial` should use the existing dates clarification (`datesClarification`, `guest-content.ts`). No new copy needed, if the owner agrees.

**4. Recommended status, order and split.**
- Recommended split: 05a is literal checkout (AC1 in its literal form, AC2, AC3, AC4 and AC5), which needs no relative date. 05b is `checkOutPhrase` (AC1 relative form), which needs 04.
- Recommended status: `needs-info`. 05a can move to `ready-for-agent` once the owner answers (a) and (b). 05b waits for 04. I have not changed the Status line.
- Order: 04 first, then 05a and 05b in one agent (both change `search_stays` and `resolveCheckInDate`, and 04's phrase helper is reused). Running 05a in parallel with 04 would conflict in the same functions.
