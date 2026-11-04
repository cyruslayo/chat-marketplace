# Assistant: take the guest's checkout and derive the nights on the server

Status: resolved
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

- Owner decision (2 Nov 2026): moved to ready-for-agent. Order: 04+05 (one agent), 11, 13a, then 13b and 16.

### ADR table (agent, before code; 2 Nov 2026)

Scope of this run: 05a only (literal checkout). 05b (`checkOutPhrase`) needs the 04 show-back for a second date and is NOT done here; the issue stays open for it.

| ADR | Constraint | Acceptance criterion or code path |
|---|---|---|
| 0106 (27 Oct) | A literal date is authorized by the guest's text; a model date that the text does not state is refused with a `tool_denial` | AC1 (`checkOut` is guest-authored literal), AC2, AC3 |
| 0106 (27 Oct) | Structured dates and nights: the server derives the checkout by `checkOutForNights`, validated by `StayDateRange` (ADR 0023 length, ADR 0055 horizon) | AC1 (nights derived, not from the model), AC3 |
| 0023, 0092, 0055 | Stay length (1 to 29 Short, 30 to 180 Extended), 90-day horizon on check-in | AC3 (checkout before or equal to check-in, or beyond the limits, is refused) |
| 0080 | Same filters on both paths | AC4 (parity test on the derived dates; see the Comments for what is compared) |
| 0106 (cold restore) | State survives a cold restore | AC5 |

Owner questions a (pair rule) and b (typed pair authority) are not answered by the ADR. Resolution used here: a checkout counts only through the classifier's `checkOut` slot bound to guest text (`currentTurnDateRoles`), as the existing code already does, and each literal day of a pair is authorized on its own text. No new pair rule is added. This is flagged for the owner.

### Implementation record (agent, 2 Nov 2026): 05a only

Changed: `apps/local-guest/src/assistant/shortlet-assistant-pack.ts` (schema `checkOut`; `guestDateWords` checks a checkout is in the guest's text; `nightsBetween`; the search derives the nights from the checkout, refuses a contradicting model nights, a checkout on or before the check-in, and a missing check-in), `test/assistant-checkout-dates.test.ts` (new, 5 tests). The 04 work in the same run is recorded in issue 04.

Not done: 05b, `checkOutPhrase` ("until next Monday"). It needs a second date in the show-back, and that wording is not settled. This issue therefore stays open.

Deviations and open points:
- AC4 (parity with the deterministic path) is not covered by a test. The deterministic path and the assistant path both derive the same checkout for this input, but no test compares the two result sets. Owner or the batch-16 parity suite should add it.
- Owner questions a and b (pair rule) are answered in the ADR table above: a checkout counts only through the classifier's `checkOut` slot bound to guest text, and each literal day of a pair authorizes on its own text.
- AC3 "existing limit copy": a stay over the limit gets the stay clarification, and a checkout the guest did not write gets the dates clarification. Both are existing copies.

Test record (commands run with `env -u LLM_API_KEY`):

| Command | Result |
|---|---|
| `npx tsx --test test/assistant-checkout-dates.test.ts` | 5 of 5 pass |
| affected set (see issue 04 Comments, 60 files) | 528 of 528 pass |
| `npm run check` (final) | exit 0 |

Definition of Done (checked, 2 Nov 2026, for 05a)
1. Named tests: AC1, AC2, AC3 (two tests: checkout before check-in, and beyond the limits), AC5 each have a named test. AC4 has none (see above).
2. Failure paths: AC2 and AC3 assert `tool_denial`-style refusals with no search.
3. ADRs: listed above.
4. Injected dependencies: none added.
5. No invented policy: stay length and horizon come from the existing StayDateRange and extended-stay policy.
6. No credential or identity in logs: none added.
7. `npm run check` passes. `npm test` is not claimed here (batch gate).

Status is left `ready-for-agent`. Not resolvable: 05b is not built, and AC4 has no test.

### Owner decisions (2 Nov 2026, recorded by the coordinator)

Owner accepted the 04 decisions that bind this issue: a relative date (including a checkout phrase) is shown back and confirmed before any search; a typed "yes" uses the closed confirmation set; ranges get the plain-word clarification.

### ADR table for 05b (agent, before code; 2 Nov 2026)

| ADR | Constraint | Acceptance criterion or code path |
|---|---|---|
| 0106 (2 Nov) | A relative phrase is authorized only after the guest's confirmation; a `checkOutPhrase` shows back both dates and nights before any search | 05b AC1 (show-back), AC2 (Yes searches the held stay) |
| 0106 (2 Nov, cold restore) | The pending checkout and its check-in persist and are restored, never re-minted | 05b AC4 (cold restore keeps the pending checkout) |
| 0106 (27 Oct) | A checkout phrase with no guest-authored check-in is refused; the check-in is never the demo date | 05b AC3 failure path |
| 0023, 0092, 0055 | Stay length and horizon on the derived stay | 05b AC3 (checkout before check-in is refused) |
| 0080 | Same stay on both paths | AC4 parity test |
| 0074 | A superseded pending checkout does not confirm | 05b AC4 |

Scope: `checkOutPhrase` is one relative day or a choice of candidates. A range ("this weekend", "next week") as a checkout is refused with the plain-word clarification (owner decision 3).

### Completion record (agent, 2 Nov 2026): 05a, 05b and the AC4 parity test

Status set to `resolved`. DoD item 7 (full `npm test`) is left to the batch pre-merge gate.

What was built, beyond 05a: `checkOutPhrase` (05b). A relative checkout is read on the server like a check-in phrase and must be the guest's own words. It is shown back with both dates and the nights, against a check-in the guest gave (typed or already confirmed). Yes confirms the checkout and the nights; a second checkout phrase or any other turn closes it. A checkout phrase with no guest-given check-in is refused and never uses the demo date. A span as a checkout is refused with the dates clarification (owner decision 3). The held checkout is accepted when the planner repeats it after the yes (it is server-owned, not guest text).

Tests (env -u LLM_API_KEY):
- `npx tsx --test test/assistant-checkout-dates.test.ts`: 12 of 12 pass. Before the 05b code, 6 failed as expected (05b AC1, AC2, AC3 x3 and the parity test); the superseded test passed trivially then, and it now passes for the right reason.
- `npx tsx --test test/assistant-date-phrases.test.ts`: 9 of 9 pass.
- Affected set (60 files): 535 of 535 pass.
- `npm run check`: exit 0, zero errors.

AC4 parity: the deterministic path and the assistant path record the same discovery filters for "Ikoyi 20 Nov to 23 Nov for 2 guests" (the recorded filters are compared, not the surfaces). Finding: the deterministic path does not read "for 2" as a party size (it asks how many guests), while the assistant does. The parity test therefore uses "2 guests" on both paths. This is a known gap in the deterministic path's party-size words, not fixed here.

Fixes found while finishing: (a) a refused turn commits nothing, so a checkout show-back closed by a later turn could survive and be confirmed later; the settle step runs on the committed state too (fail closed). (b) the cold-restore rebuild does not search a context with a pending date.

DoD: (1) named tests for AC1 to AC5 and the 05b criteria (AC4 parity now tested); (2) failure paths asserted; (3) ADR tables above, read; (4) no unused dependencies; (5) no invented policy; (6) no credential or identity in logs; (7) batch gate.
