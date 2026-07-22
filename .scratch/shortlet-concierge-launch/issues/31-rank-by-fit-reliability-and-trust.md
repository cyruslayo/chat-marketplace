# Rank discovery by fit, reliability, and transparent trust

Status: resolved
Type: AFK
User stories: 5–7, 9

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Rank eligible Units organically using guest fit, All-In Stay Total value, current Verification Claims, availability, fulfilment and calendar reliability, response performance, turnover readiness, listing freshness, and expressed preferences. Show specific trust facts and approximately 750-metre-obscured location without sponsored placement.

## Acceptance criteria

- [x] Ineligible inventory never ranks and no launch input represents paid placement.
- [x] Ranking inputs are versioned, explainable, current, and derived from authoritative projections.
- [x] Reliability metrics use the accepted trailing window and minimum opportunities while lifetime completion remains distinct.
- [x] Location projection preserves useful neighbourhood context without exposing precise address.

## Blocked by

- [Issue 01](01-browse-one-eligible-unit.md)
- [Issue 04](04-onboard-and-publish-one-inspected-unit.md)
- [Issue 28](28-post-commission-and-revenue-release.md)
- [Issue 29](29-apply-graduated-operator-enforcement.md)
- [Issue 30](30-calculate-reserve-payout-and-trust-tier.md)

## Answer

Implemented `OrganicRankingEngine` in `domains/shortlet/src/ranking.ts` and test suite `test/rank-by-fit-reliability-and-trust.test.ts`.

Key architectural compliance:
- **ADR 0066**: Organic discovery ranking by fit, All-In Stay Total, verification, reliability, listing freshness; strict prohibition of sponsored/paid placement.
- **ADR 0066 & AC3**: Enforced trailing 90-day reliability metrics display only when operator has at least 10 opportunities; lifetime completed stays remain distinct.
- **ADR 0066 & AC4**: Obscured location projection (~750m precision) showing neighbourhood context without exposing exact street address before payment confirmation.

