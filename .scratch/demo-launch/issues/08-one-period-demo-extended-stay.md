# Wire a 30-night demo Extended Stay through booking and payment

Status: ready-for-agent
Type: AFK
Blocked by: 04

## Parent

[Public Live Demo Launch PRD](../PRD.md)

## Why

Issue 05 now needs monthly prices and unit terms. The current application has no Extended Stay quote or payment-period runtime. Start with one complete 30-night journey before extending it to six periods.

## What to build

- Add versioned Monthly Agreed Amounts and a structured utilities/servicing statement to the Unit. Use ADR 0092 and the existing `UnitOwnerTerms` margin model.
- Add the 30-night Extended Stay quote, Request to Book, offer, first Period Payment, and confirmed contract for demo mode.
- Use the existing payment gateway and server-side verification. Tests use stubbed Paystack TEST responses; they never create a live transaction. A verified first Period Payment confirms the stay and blocks its dates through the existing command path.
- Wire both the Node local pilot and the Cloudflare Durable Object repositories. Tests must exercise those compositions and the authenticated `/_ops` import path.
- Gate demo-only behavior on authoritative configuration. Require the existing Cloudflare Access JWT and `OPS_SHARED_SECRET` for every `/_ops` request.
- Keep the public Worker unavailable when required demo inventory is absent. Keep production demo refusal in force.

## Acceptance criteria

- AC1: An authenticated operator import creates one opted-in synthetic Unit with Monthly Agreed Amounts and a utilities statement. Missing or wrong credentials import nothing.
- AC2: A 30-night quote uses the Monthly Agreed Amounts plus margin, and carries the amount, utilities and Billing Period values into the Request to Book.
- AC3: A valid verified test-mode first Period Payment confirms one 30-night booking once and blocks all 30 nights.
- AC4: A missing, invalid, mismatched or superseded provider verification confirms nothing and marks no payment successful.
- AC5: An unverified Period Payment releases its hold at the Payment Window deadline, without confirming a booking.
- AC6: The same 30-night journey works through the Node local pilot and Cloudflare Durable Object storage, including restart recovery.
- AC7: Demo booking behavior is refused in production and when demo mode is disabled. Existing Short Stay tests pass unchanged.

## Validation

Create one named behavioral test per acceptance criterion, including each failure path. Use stubbed Paystack TEST responses. Run only the affected Node, Worker and real-Chrome tests. Do not create live transactions or use production credentials.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0005, 0072, 0080 | Request to Book, confirmation and payment remain on the authorized command path | AC2–AC4 |
| 0015, 0089, 0092 | All-in pricing, Monthly Agreed Amounts, margin and a 30-night Billing Period | AC2–AC3 |
| 0075 | No secrets or guest identity data in logs or audit records | AC1, AC4 |
| 0087 | Staging uses server-verified Paystack test payments | AC3–AC4 |
| 0095 | Cloudflare Durable Object SQLite remains authoritative | AC5 |
| 0105 | Demo behavior is staging-only and uses synthetic units | AC1, AC6 |

## Source issues

- [Monthly-stays issue 04](../../monthly-stays/issues/04-extended-stay-eligibility.md)
- [Monthly-stays issue 05](../../monthly-stays/issues/05-monthly-price-and-utilities.md)
- [Monthly-stays issue 06](../../monthly-stays/issues/06-billing-periods-and-period-payments.md)

## Definition of Done

Use the repository checklist. Preserve all existing Short Stay tests unchanged. Run `npm run check` and the tests that cover this path. Record exact commands and counts in `## Comments`. Do not run the batch suites here.

## Comments
