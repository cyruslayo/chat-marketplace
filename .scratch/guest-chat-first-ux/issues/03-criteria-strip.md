# Editable criteria strip with live re-search

Status: split
Type: epic
Findings: F1, F10 (see ../PRD.md)

## What to build

Add a persistent strip above the composer showing chips for Where, When, Guests and Budget. Tapping a chip edits it in place (a date range picker, a guest stepper). Committing an edit sends an event and updates the active results. Include "Undo last change".

Budget is new: nothing in `concierge.ts` or `browse.ts` supports it today.

## Decision: what a budget means (approved 25 Sept 2026; decided by ADR 0015)

- Budget is compared against the **All-In Stay Total** for the stay. It never includes the Refundable Security Deposit.
- Results are filtered and ranked on the All-In Stay Total. The deposit and the total cash requirement are shown separately on each result.
- A nightly budget ("₦60k a night") is accepted and converted to a stay total using the current nights, then shown back ("₦180,000 total for 3 nights, all fees included"). Any nightly figure shown is labelled as derived from the all-in total.
- Without dates and party size, the budget chip is qualified ("about") and no result is described as within budget.
- An apartment within budget whose deposit takes the cash requirement over budget is still shown, with a note that the refundable deposit is paid separately.

## Split

This issue is delivered by:
- [03a](03a-criteria-strip.md): AC1–5
- [03b](03b-budget.md): AC6–9

## Acceptance criteria (reference)

- AC1: The strip always shows the current server-side criteria after each turn.
- AC2: Editing a chip re-runs the search and replaces the results surface without a typed message.
- AC3: An edit that breaks policy (for example 15 nights) is rejected inline with the limit stated, and the previous value is kept.
- AC4: "Undo last change" restores the previous criteria and results.
- AC5: The strip can be operated by keyboard alone and reflows at 320px.
- AC6: Budget filtering compares the All-In Stay Total and excludes the Refundable Security Deposit.
- AC7: A nightly budget is converted to a stay total using the current nights and shown back as a total.
- AC8: Without dates or party size, no result is described as within budget.
- AC9: An apartment within budget only before its deposit is still listed, with the deposit shown separately.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0004 | Criteria are server state; the client never searches on its own |
| 0015 | Budget filtering uses the All-In Stay Total; deposit shown separately; no budget promises without a quote |
| 0016 | Refundable Security Deposit is not stay cost |
| 0073 / 0081 | Use Basic Catalog components first; custom ones need evidence the catalogue is insufficient |
| 0078 | 44px targets, 320px reflow, keyboard operable |
| 0080 | The same criteria are editable on the conventional search route |

## Definition of Done

Resolved when every child issue is resolved.
