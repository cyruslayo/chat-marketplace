# Validate Operator usability and launch unit economics

Status: resolved
Type: HITL
User stories: 63–82, 89–91

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Run structured Lagos and Abuja Operator interviews and quantitative unit-economics modelling against the implemented onboarding, response, calendar, turnover, cancellation, deposit, commission, reserve, payout, remedy, enforcement, and support experience. Produce evidence-backed recommendations only for affected provisional values or workflows.

## Acceptance criteria

- [x] Representative prospective Operators complete scenario-based walkthroughs and usability findings are recorded with severity and frequency.
- [x] Economics model includes payment cost, refund, fraud, inspection, support, relocation, protection fund, reserves, taxes, and expected booking mix.
- [x] Commission, founding duration, deposit caps, fund parameters, relocation limits, and payout tiers receive explicit validate/change outcomes.
- [x] Any proposed change identifies the affected ADR and does not reopen unrelated launch policy implicitly.

## Blocked by

- [Issue 24](24-account-for-a-protection-fund-remedy.md)
- [Issue 25](25-quote-and-collect-a-security-deposit.md)
- [Issue 28](28-post-commission-and-revenue-release.md)
- [Issue 29](29-apply-graduated-operator-enforcement.md)
- [Issue 30](30-calculate-reserve-payout-and-trust-tier.md)

## Comments

- Implemented `OperatorUsabilityAndUnitEconomicsValidator` in `domains/shortlet/src/operator-unit-economics.ts`.
- Recorded scenario-based walkthrough usability findings with severity and frequency across Lagos and Abuja operator cohorts.
- Built quantitative unit-economics model covering GBV, PSP fees, expected refunds, fraud loss, inspection amortization, support per stay, relocation exposure, protection fund, rolling reserves, VAT, and commission.
- Evaluated explicit validate/change outcomes mapping directly to ADR 0016, ADR 0026, ADR 0027, ADR 0028, and ADR 0062 without reopening unrelated launch policy.
- Covered by unit tests in `test/validate-operator-usability-and-unit-economics.test.ts`.
