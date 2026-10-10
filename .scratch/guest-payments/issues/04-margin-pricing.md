# Margin pricing and owner payable

Status: resolved
Type: task
Blocked by: none

## What to build

Implement ADR 0089 pricing.

- Each unit records the owner's agreed amounts (nightly rate and mandatory charges) and a margin rate. Both are versioned unit data in the inventory file.
- The quote derives the Guest's All-In Stay Total as the agreed amounts plus the margin (plus any taxes). It is shown as one price.
- The booking snapshot captures the owner payable and the margin, so the back office can show them later.
- Launch listings carry a zero deposit.

## Acceptance criteria

- AC1: For a unit with agreed amounts and a margin rate, the quote's All-In Stay Total equals the agreed amounts plus the margin, and the Guest sees only that one total.
- AC2: A confirmed booking's snapshot records the owner payable and the margin, and neither changes if the unit's rate or margin changes later.
- AC3: A unit missing its agreed amounts or margin rate cannot be quoted and fails closed at inventory import.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0089 | margin charged on top; owner payable captured at confirmation |
| 0015 | one all-in price; no later fee |
| 0077 | snapshots are never recalculated |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest wording for money and deadlines traces to CONTEXT.md or an ADR.
- [x] No keys, secrets, account numbers or webhook bodies in logs or telemetry (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

Resolved 27 Sept 2026 on branch `pay/p4-margin-pricing` (commit `c55e3a3`), stacked on B6.

- `domains/shortlet/src/owner-terms.ts` holds `UnitOwnerTerms` (agreed nightly and mandatory charges, `marginBasisPoints`), `unitPriceFromOwnerTerms`, `unitOwnerTerms` (fails closed), `ownerSettlementFor` and `parseMarginPercent`. The Unit price keeps its Guest amounts, derived from `price.ownerTerms`. A price that no longer derives from its terms is refused.
- `createStayQuote` adds `ownerSettlement` (`ownerPayableKobo`, `marginKobo`, `marginBasisPoints`, `agreed`, `nights`). The offer's quote and the Booking Contract carry it; guest projections do not.
- Import: `owner_nightly_ngn`, `owner_mandatory_charges_ngn` and `margin_percent` are required. The old guest-price columns are rejected. Onboarding blocks publication without owner terms.
- Decisions taken with the user: new columns (not reused ones); the margin is rounded down to whole kobo per agreed amount (precedent: tax and commission in `quote.ts`).
- Tests: `test/margin-pricing.test.ts` (AC1–AC3). The full suite passes except the known-flaky `pilot-local` AC4.

## Comments

- ADR 0089 (margin on top, payable captured at confirmation), ADR 0015 (one all-in price), ADR 0077 (snapshots never recalculated) were read and applied. ADR 0089 is on `adr/payments-and-margin` (PR #68), not yet on this stack.
- Existing pilot inventory JSON has no owner terms. Those units fail closed until re-imported with the new columns (see `docs/shortlet-pilot-inventory-operations.md`).
