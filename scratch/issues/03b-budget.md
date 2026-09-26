# Budget chip compared against the All-In Stay Total

Status: resolved
Type: task
Blocked by: 03a
Parent: [03](03-criteria-strip.md)

## What to build

Add the Budget chip and apply the approved decision in the parent issue (ADR 0015). `browse.ts` already filters on `maxPriceKobo` against the All-In Stay Total (:306, :348) and needs dates and party size (:333–335). Add: converting a nightly budget to a stay total, ranking, and the deposit note in `discovery-a2ui.ts`. Fix the gap where a unit with no total counts as `?? 0` and passes any budget.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC6: Budget filtering compares the All-In Stay Total and excludes the Refundable Security Deposit.
- AC7: A nightly budget is converted to a stay total using the current nights and shown back as a total.
- AC8: Without dates or party size, no result is described as within budget.
- AC9: An apartment within budget only before its deposit is still listed, with the deposit shown separately.
- AC10: A unit without an All-In Stay Total is never described as within budget.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0015 | Budget filtering uses the All-In Stay Total; deposit shown separately; no budget promises without a quote |
| 0016 | Refundable Security Deposit is not stay cost |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

- **Criteria.** `DiscoverySearchContext.budget` is `{ kobo, per: "stay" | "night" }`, in `concierge.ts`.
  - `extractBudget` reads "budget ₦500k", "under 200,000 naira" and "₦60k a night". A bare small number ("under 3 nights", "max 4 guests") is never money: it needs a ₦ sign, k/m, "naira", or at least ₦1,000.
  - A stated amount is no longer listed as the unsupported "price level".
  - The budget is merged, persisted (`parseDiscoverySearchContext`) and restated in clarify replies.
- **Search** (AC6, AC7). `resolveStayRequestContext` adds `maxPriceKobo = stayBudgetKobo(context)`, so a nightly budget is multiplied by the current nights at every search. Changing the nights re-converts it.
- **Domain** (`browse.ts`).
  - Price filters use `withinPrice`: a unit with no All-In Stay Total fails closed instead of counting as `?? 0` (AC10).
  - With a budget, results are ranked by All-In Stay Total, and the sort is stable (ADR-0015).
  - The existing refusal of a price filter without dates and party size is kept.
- **Shown back** (AC7, AC8). `budgetLabel` gives the approved form, "₦180,000 total for 3 nights, all fees included". It is prefixed "About" until arrival, nights and party size are all known, and a nightly budget without nights reads "About ₦60,000 a night". No search runs without dates and party size, so nothing is described as within budget before then.
- **Cards** (AC9, AC10). `budgetNote` in `discovery-a2ui.ts` adds a line only when a unit has an All-In Stay Total at or under the budget: "Within your ₦380,000 budget (All-In Stay Total)."
  - When the deposit takes the cash needed over the budget, it adds: "The Refundable Security Deposit is paid separately, so the total to complete booking is ₦390,000."
  - The deposit line itself is unchanged.
  - The search reply and the search summary name the budget.
- **Strip.** A Budget chip whose editor has a whole-naira amount, a Total-for-the-stay or Per-night choice, a hint (glossary terms), and "Remove budget".
  - The events are `{ field: "budget", naira, per }` and `{ field: "budget", clear: true }`. Anything else is `INVALID_CRITERIA`.
  - `MAX_BUDGET_NAIRA` is an input sanity bound, not a pricing policy.
  - The budget is part of the criteria `key` and of undo.
- **ADR-0080.** `/stays/search` accepts `maxPriceKobo` (the route the chat links to) and an optional form field `budget` (whole naira; empty means none). It fails closed when both are given or when the value is malformed.
- **Tests.** `test/guest-budget.test.ts` covers AC6–AC10 and the chip plus form parity, with failure paths:
  - one naira under the total excludes a unit;
  - counts are not read as money;
  - "within budget" is never shown without a quote or on a unit without a total;
  - there is no deposit warning when the deposit fits;
  - a fractional, negative or unknown-basis budget is rejected;
  - a malformed form budget is rejected.
- **Walkthrough on :3005 at 375px and 1280px.** The Ikoyi card showed the deposit note and the Lekki card showed only "within". No overflow.
- **S12 note.** With four chips, the closed strip is 157px at 375px (105px at 1280px).
- Verification: `npm run check` passed. `npm test`: 1,139 passed, 1 failed, 1 skipped. The failure was real: `mobile-guest-journey-chromium` AC15 found the empty Budget chip ("Add") 43.5px wide. Chips now have a 44px minimum width, and that test and the strip tests pass.
