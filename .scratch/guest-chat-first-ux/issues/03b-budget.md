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

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.

## Comments
- 28 Sept 2026: the audit for launch-readiness issue 10 found this work implemented and tested on main, but this file was never set to resolved. The status is left for a human to confirm against the Definition of Done.
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Answer: `scratch/issues/03b-budget.md` (repo root). A budget chip (total for the stay or per night) is stored in the discovery context. A nightly budget is multiplied by the current nights at each search. `withinPrice` fails closed when a unit has no All-In Stay Total, and the "within budget" line appears only with a quote.
  - Evidence: test/guest-budget.test.ts (AC6–AC10 with failure paths). Code: apps/local-guest/src/concierge.ts (`extractBudget`, `stayBudgetKobo`); domains/shortlet/src/browse.ts (`withinPrice`); apps/web-agent/src/discovery-a2ui.ts (`budgetNote`). Landing: PR #62, commits c1ce01b, 473b4ae.
  - Verified: non-browser tests for this group were run on 11 Oct 2026 (75 of 75 pass).
  - Not verified: real-Chrome tests (`*-chromium.test.ts`, `mobile-guest-journey-chromium.test.ts`) were not run in the reconciliation sandbox (no Chrome); they pass in the CI `browser` job on main. The 320/390/768/1280 screenshots and the ADR 0078 capture sweep were not re-checked. The Definition of Done checklist was not re-ticked item by item in this reconciliation.
