# Budget chip compared against the All-In Stay Total

Status: ready-for-agent
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
