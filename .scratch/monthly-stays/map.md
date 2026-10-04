# Map: monthly stays (Extended Stay)

PRD: `PRD.md`

Furnished, verified stays of 30 to 90 nights (ADR 0092), paid one Billing Period at a time.
- **Core segments:** assignment professionals, and relocating people.
- **Seasonal offer:** the diaspora on long visits.

Work top to bottom. The frontier is the first issue that is open, unblocked and unclaimed. Code issues end with `npm run check` and `npm test` green and a commit.

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 01 | [Run the 60-day manual monthly pilot](issues/01-manual-monthly-pilot.md) | task | ready-for-human | none |
| 02 | [Legal and tax review: licence vs tenancy, receipts](issues/02-legal-review-licence-and-receipts.md) | research | ready-for-human | none |
| 03 | [Decide the Extended Stay policy (ADR 0092 and glossary)](issues/03-decide-extended-stay-policy.md) | grilling | resolved | none (counsel items stay open in 02) |
| 04 | [Extended Stay eligibility](issues/04-extended-stay-eligibility.md) | task | ready-for-agent | 03 |
| 05 | [Monthly price, margin and what's included](issues/05-monthly-price-and-utilities.md) | task | ready-for-agent | 03 |
| 06 | [Billing Periods and Period Payments](issues/06-billing-periods-and-period-payments.md) | task | ready-for-agent | 04, 05 |
| 07 | [Period Owner Payable](issues/07-period-owner-payable.md) | task | ready-for-agent | 06 |
| 08 | [Cancellation and Notice to End](issues/08-cancellation-and-notice-to-end.md) | task | ready-for-agent | 06 |
| 09 | [Extend an Extended Stay](issues/09-extend-an-extended-stay.md) | task | ready-for-agent | 06 |
| 10 | [Stay receipt for each Billing Period](issues/10-stay-receipt-per-period.md) | task | ready-for-agent | 02, 06 |
| 11 | [Guest discovery for monthly stays](issues/11-guest-discovery-for-monthly-stays.md) | task | ready-for-agent | 04, 05 |
| 12 | [Servicing and maintenance requests](issues/12-servicing-and-maintenance-requests.md) | task | ready-for-agent | 05, 06 |
| 13 | [Define "house-hunt while you stay"](issues/13-house-hunt-while-you-stay.md) | grilling | ready-for-human | 01 |
| 14 | [Seasonal "Home for the Holidays" offer](issues/14-seasonal-holiday-offer.md) | task | needs-info | 05, 11 |
| 15 | [Decide the operator tier menu](issues/15-operator-tier-menu.md) | grilling | ready-for-human | none (tested in 01) |
| 16 | [Operator earnings projection and guest value comparison](issues/16-earnings-projection-model.md) | prototype | ready-for-human | none (code waits for 05) |

## Critical path

01 and 02 run in parallel now; they are people work, not code. 15 and 16 are supply-side commercial work that runs inside the 01 pilot: the earnings projection is the onboarding tool, and each operator's tier choice is pilot evidence. 03 turns their answers into ADR 0092. Then 04 and 05, then 06, then 07–12. Nothing in 04–12 starts before ADR 0092 is accepted, because they depend on its values.

## Rules for every code issue

- Read the ADRs in the issue's table plus ADR 0092. Use only values from ADR 0092 and `CONTEXT.md`; ask for anything missing.
- Short Stay behaviour must not change. The existing Short Stay tests must pass unchanged.
- Guest screens follow the AGENTS.md "Guest UI work" rules and end with captures under `screenshots/<issue>/`.

## Context pointers (append as issues resolve)
- 03 resolved, 4 Oct 2026: ADR 0092 accepted except the [counsel] items. Extended Stay is 30–90 nights with 30-night periods, a short final period at the nightly rate, payment due 7 days before each period, cancellation 100% at T-30d and 50% at T-14d, 14-day notice, zero deposit. Glossary entries are in `domains/shortlet/CONTEXT.md`. The frontier for code is now 04 and 05.
