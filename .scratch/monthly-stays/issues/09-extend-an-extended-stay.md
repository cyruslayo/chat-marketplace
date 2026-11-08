# Extend an Extended Stay

Status: ready-for-agent
Type: task
Blocked by: 06, 17, 18

## What to build

The guest can add Billing Periods (the last may be shorter, priced per night) to a confirmed Extended Stay through a Booking Amendment (ADR 0060, ADR 0092 "Extensions").

- Check availability for the added nights, a fresh quote at the current Monthly Agreed Amounts, Request to Book approval, and validity of inspection and authority through the new checkout (ADR 0056, ADR 0057).
- The total length must stay within the Extended Stay range. Adding periods appends new Billing Periods and Period Owner Payables. Existing periods are never repriced.
- Extensions cannot be agreed in chat or arranged off-platform (ADR 0023).

## Refresh (8 Nov 2026)

Since this issue was written:
- Extended Stays run **30 to 180 nights** in every deployment (ADR 0092 as amended 1 Nov 2026). "The Extended Stay maximum" in AC2 is the policy's `maximumNights` (180).
- `domains/shortlet/src/booking-amendment.ts` still refuses any amended stay over `MAX_STAY_NIGHTS` (29), so no Extended Stay can be lengthened. For a contract whose stay type is Extended, the length check must use the Extended Stay policy instead; a Short Stay keeps the 29-night cap (extending a Short Stay to 30+ nights is not an extension, ADR 0023 as amended).
- Continuous Occupancy (short-stays-29-nights issue 06) applies to extensions: the whole chain must stay within 180 nights.
- Notice to End (issue 17) and extensions both amend the contract: an extension must refuse while a Notice to End is in force, and vice versa, unless ADR 0092 says otherwise (check; ask if unclear).
- Guest entry point: the same confirmed-booking chat surface and button-only confirmation pattern as issue 18, with a confirmation step that shows the added periods, their amounts and due dates before the Request to Book is sent. Proposed labels, for the owner to confirm: action "Extend your stay"; confirm button "Request extension".

## Acceptance criteria

- AC1: An extension request with available nights, operator approval and valid inspection and authority commits as a Booking Amendment that appends priced periods.
- AC2: An extension that would exceed the Extended Stay maximum is rejected before quoting.
- AC3: An extension whose new checkout falls after inspection or authority expiry is rejected.
- AC4: If any night in the extension is unavailable, the extension is rejected and the original contract is unchanged.
- AC5: Existing periods, their amounts and their payables are unchanged by an extension.
- AC6: An extension that would make the Continuous Occupancy chain longer than 180 nights is refused.
- AC7: With the assistant enabled and a cold restore before every event, a guest can request an extension from the confirmed booking and sees the added periods before sending; refusals are `tool_denial`.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0092 | 30–90 nights; "Extensions" |
| 0060 | Versioned amendment, atomic |
| 0023 | No informal extensions |
| 0056, 0057 | Validity through the new checkout |
| 0015 | Fresh quote |

## Definition of Done

See `docs/agents/issue-tracker.md`.

## Comments

- **8 Nov 2026, Claude (not started; blocked, status left `ready-for-agent`).** Read the issue, issues 17 and 18 (Comments), AGENTS.md, ADR 0092 (Billing Periods, Notice to End, Extensions), 0060, 0023, 0092 extension clauses, and the code paths below. No code was written for AC1–AC7 and no tests were added. Reasons, each verified in the tree:
  1. **Dependency 06 is open.** `.scratch/monthly-stays/map.md` row 06 is `ready-for-agent`, and this issue is `Blocked by: 06, 17, 18`. 17 and 18 are resolved. 06 is not, so 09 cannot be closed on top of it. Billing Period quoting and append code exists (`domains/shortlet/src/period-payment.ts`, `owner-payable.ts`, `quote.ts`, `extended-stay-changes.ts`), but 06's own acceptance criteria are not recorded as passing.
  2. **No Request to Book approval for amendments (design gap).** ADR 0092 "Extensions" requires Request to Book approval. `domains/shortlet/src/booking-amendment.ts` has only guest acceptance (`acceptAmendment`) and a trusted-backend commit (`commitAmendment`); there is no operator approval step. The only operator approval in the tree is for Booking Requests (`apps/local-guest/src/fixture.ts:765` `simulateOperatorAcceptance`, and `apps/local-guest/src/assistant/shortlet-stage-handlers.ts:207`). Routing an extension through a new Booking Request is a design decision for the owner, not something to improvise.
  3. **Length cap is still 29 for every amendment.** `booking-amendment.ts` (the `request` method) throws `Stay length exceeds the maximum Short Stay limit of ${MAX_STAY_NIGHTS} nights` for any contract, so an Extended Stay cannot be lengthened. The fix is specified in the Refresh section (use the Extended Stay policy for Extended contracts, keep 29 for Short Stays). That is a small change, but it has no effect until 2 is decided.
  4. **Notice exclusivity is not enforced.** No code checks for an in-force Notice to End when an amendment is requested, or for a pending extension when a notice is given. ADR 0092 does not say otherwise, so this follows the issue text.
- **Next step for the owner.** Confirm (a) that 06 is accepted as resolved, or that 09 may proceed on the current Billing Period code; and (b) the approval route for an extension (for example, an operator-approved Booking Request that carries the amendment, or a new operator approval step on amendments). Once decided, the work order is the tests-first list in the issue, AC1–AC7 plus the three named tests.
- **Strings proposed (not added to the code).** "Extend your stay" (action); "Request extension" (confirm button).
