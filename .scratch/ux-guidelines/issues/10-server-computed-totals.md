# 10 · Server-computed total plus deposit in discovery

Status: resolved
Type: grilling
Blocked by: none
Phase: 1 (Batch A)
Applicable ADRs: 0015, 0102; guideline §10 price hierarchy

## What to build

`apps/web-agent/src/discovery-a2ui.ts:147-148` adds the All-In Stay Total and the deposit to build the budget note. The guideline says totals come from the domain projection only. Decide with the owner:

1. Add a projected `amountDueAtPaymentKobo` (or the existing equivalent) to the discovery projection in `domains/shortlet` and render it; or
2. Record that presentation-level addition of two projected amounts is allowed under ADR 0015, and add a test pinning it to the projection fields.

Note: the landing page's `DUE_KOBO` (`landing-page-html.ts:69`) is static demo copy and is out of scope.

## Acceptance criteria

1. The owner's decision is recorded here and in map.md
2. If option 1 is chosen, a follow-up task issue is written
3. If option 2 is chosen, the pinning test exists

## Rules

- Grilling: ask the owner. Change no code until they decide.

## Comments

### Owner decision (recorded)

**Option 1, using the existing projected field.** The discovery projection already computes `amountDueNowKobo` server-side in `domains/shortlet/src/browse.ts:372` (the Extended Stay first-period amount, otherwise All-In Stay Total plus the deposit). `discovery-a2ui.ts:147` was the only place that re-added the two amounts. The budget note now renders `unit.price.amountDueNowKobo`, omits the amount sentence when it is null, and keeps the "within budget" comparison on the All-In Stay Total alone (ADR 0015, ADR 0016).

### ADRs read and applied

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0015 | All-In Stay Total is the stay total; the deposit is separate; no invented money. | The budget comparison still uses `allInStayTotalKobo`; the note shows the projected amount due now. |
| 0102 | Prices are projections; a channel renderer never recalculates them. | The presentation reads `amountDueNowKobo` from the projection instead of adding. |
| 0016 | The Refundable Security Deposit is separate from the stay total. | The deposit remains its own fact; it is not added to the All-In Stay Total. |

### Follow-up (AC2)

No follow-up task issue is needed: the projected equivalent (`amountDueNowKobo`) already exists, so there is no domain change to schedule. The remaining vocabulary question ("Amount Due Now" versus "Total to complete booking") stays with the owner decision recorded in `map.md` and issue 12/05.

### Tests and commands

- `npm run check` — 0 errors.
- `npx tsx --test test/discovery-budget-note.test.ts` — 3 tests, 3 passed, 0 failed.

## Answer

The discovery budget note renders the server-projected `amountDueNowKobo` and never adds the All-In Stay Total and the deposit in presentation. A null amount omits the sentence, and an amount within budget keeps the short note. A pinning test proves the rendered figure is the projection field, not a presentation sum.
