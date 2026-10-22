# Extend demo quotes and contracts through 180 nights

Status: resolved
Type: AFK
Blocked by: 08

## Parent

[Public Live Demo Launch PRD](../PRD.md)

## Why

The owner authorized synthetic staging demo bookings through 180 consecutive nights. ADR 0092's 30-night Billing Period and price rules remain unchanged.

## What to build

- Extend the working 30-night path from issue 08 to demo stays through 180 consecutive nights.
- Keep 30-night Billing Periods. A 180-night stay has six periods. A shorter final period uses nightly Owner's Agreed Amounts plus margin.
- Snapshot each period's dates, amounts, and nightly contracted values in the quote and Booking Contract.
- Preserve ADR 0055's 90-day check-in horizon and validate inspection, authority and regulatory claims through the final checkout.
- Keep the 180-night exception confined to staging demo mode and local demo verification. Production remains capped at 90 Extended Stay nights after its ordinary launch gates close.

## Acceptance criteria

- AC1: A six-period 180-night demo quote totals the six period amounts and snapshots all six periods.
- AC2: A quote for a length with a shorter final period uses the nightly price for only that final period, with exact nightly contracted values.
- AC3: Staging demo requests from 30 through 180 nights pass only for opted-in units with complete monthly pricing and utilities facts.
- AC4: Lengths of 15–29 or more than 180 nights are rejected before search results, quote, identity verification, hold or payment. A non-demo or production request over 90 nights is rejected.
- AC5: A check-in beyond the 90-day horizon or any checkout beyond inspection, authority or regulatory expiry is rejected at each required recheck point.
- AC6: Short Stay lengths, prices, horizon checks and anti-fragmentation behavior pass their existing tests unchanged.

## Validation

Create one named behavioral test per acceptance criterion, including each failure path. Use the real booking and storage compositions from issue 08. Run only affected Node, Worker and real-Chrome tests.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0023 | Short Stays remain 1–14 nights; 15–29 nights stay unsupported | AC4, AC6 |
| 0055 | 90-day check-in horizon and validity rechecks | AC5 |
| 0056, 0057, 0009, 0065 | Inspection, authority and regulatory validity through checkout | AC5 |
| 0089, 0092 | Monthly amount, margin, period and shorter-final-period pricing | AC1–AC3 |
| 0105 | 180-night maximum applies only to synthetic staging demo bookings | AC3–AC4 |

## Source issues

- [Monthly-stays issue 04](../../monthly-stays/issues/04-extended-stay-eligibility.md)
- [Monthly-stays issue 05](../../monthly-stays/issues/05-monthly-price-and-utilities.md)

## Definition of Done

Use the repository checklist. Preserve all existing Short Stay tests unchanged. Run `npm run check` and the tests that cover this path. Record exact commands and counts in `## Comments`. Do not run the batch suites here.

## Comments

### Implementation record (22 Oct 2026)

Implementation commit: `c398e16` (10 files, explicit paths). The tracker commit follows this record.

ADR table, checked against the code paths:

| ADR | Constraint | Where it is enforced | Criteria |
| --- | --- | --- | --- |
| 0092 | 30-night Billing Periods; full period at Monthly Agreed Amounts plus margin; shorter final period at the nightly price; first Period Payment confirms one period; 30-90 production limit kept | `quote.ts` period loop and `totalAmountDueNowKobo`; `extended-stay.ts` demo policy (30-180, staging only); production gets no policy from the fixture | AC1, AC2, AC3, AC4 |
| 0089 | Owner terms and margin derive the guest price | `quote.ts` uses `guestPriceFromOwnerTerms` and `marginOnKobo`; `owner-terms.ts` unchanged | AC2 |
| 0055 | 90-day check-in horizon at search, draft, disclosure, confirmation and payment initialization | `browse.ts` `StayDateRange` (unchanged); `card-payment.ts` payment initialization now constructs `StayDateRange` for Extended Stays | AC5 |
| 0056, 0057, 0009, 0065 | Inspection, authority, licence and insurance cover checkout | `browse.ts` `isEligibleUnit` (unchanged) at search; `booking-request.ts` `#assertExtendedStayEligible` at draft and disclosure; existing offer acceptance and payment checks | AC5 |
| 0023 | Short Stays 1-14 nights; 15-29 unsupported | `browse.ts` and `extended-stay.ts` `assertStayLength` (unchanged); the demo policy minimum is 30 | AC4, AC6 |
| 0105 (amended) | 180 nights only for the staging demo; production refuses demo | `DEMO_EXTENDED_STAY_POLICY.maximumNights = 180`; `fixture.ts` supplies the policy only when demo and not production; production composition refused at startup (issue 08 AC7) | AC3, AC4 |

Changes made:
- `domains/shortlet/src/extended-stay.ts`: demo maximum 30 to 180 nights, with the scope stated in a comment.
- `domains/shortlet/src/quote.ts`: a shorter final period is priced per night at the Short Stay guest price. The old code applied the margin to the whole block, which drifted by 1 kobo on a 10-night period. `totalAmountDueNowKobo` is the first Billing Period for an Extended Stay. New `stayAmountDueNowKobo` helper.
- `domains/shortlet/src/card-payment.ts`, `bank-transfer.ts`, `manual-transfer.ts`: the stay amount of the first payment uses `stayAmountDueNowKobo`. Card payment also rechecks the 90-day horizon for Extended Stays.
- `domains/shortlet/src/booking-request.ts`: draft and disclosure recheck opt-in, monthly and utilities facts, and eligibility through checkout, for stays over 14 nights only. Short Stay behaviour is unchanged.
- Tests: `test/demo-extended-stay-180.test.ts` (new, 10 tests); `test/helpers/demo-extended-journey.ts` (new shared journey helper); `test/demo-extended-stay.test.ts` (the issue 08 journey now uses the shared helper; its assertions are unchanged); `test/demo-extended-assistant.test.ts` (see deviations).

### Red-first evidence

Command, run before implementation: `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/demo-extended-stay-180.test.ts`. Result: tests 10, pass 1, fail 9. The one pass is AC6, which pins existing Short Stay behaviour. The failures were the 30-night demo cap (`stay length is outside the configured ranges`). Two later corrections were to the test harness, not to the implementation: the journey Unit was not the one the request used, and the journey Unit lost the demo operator's identity. Both were fixed in `test/helpers/demo-extended-journey.ts` and rerun against the implementation. The AC2 rounding case was not isolated red, because its first red failure was the cap. Its expected value is arithmetic: a 10-night final period at guest nightly 1,123,401 must total 11,234,010, where the old per-block margin gave 11,234,011.

### Verification (final, after implementation)

- `npm run check` (tsc for the root, apps/cloudflare, its test and tooling configs, and the Worker bundle guard): passed with zero errors.
- Own file: `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/demo-extended-stay-180.test.ts`: tests 10, pass 10, fail 0.
- Affected Node set, part 1: `npx tsx --test test/demo-extended-stay-180.test.ts test/demo-extended-stay.test.ts test/demo-extended-assistant.test.ts test/margin-pricing.test.ts test/quote-and-collect-a-security-deposit.test.ts test/expire-transfer-and-refund-late-payment.test.ts test/back-office-manual-transfers.test.ts test/integrate-booking-request-application.test.ts test/integrate-conditional-offer-application.test.ts test/integrate-card-payment-application.test.ts test/browse-one-eligible-unit.test.ts`: tests 65, pass 65, fail 0.
- Affected Node set, part 2: `npx tsx --test test/paystack-pilot.test.ts test/guest-discovery-reasons.test.ts test/rank-by-fit-reliability-and-trust.test.ts test/integrate-booking-contract-application.test.ts test/guest-draft-revision.test.ts test/demo-mode-guest.test.ts test/inventory-import.test.ts test/integrate-booking-amendment-application.test.ts test/guest-process-restart.test.ts test/pilot-production-composition.test.ts test/pilot-database-handle.test.ts test/pilot-guardrails.test.ts`: tests 162, pass 162, fail 0.
- Affected Worker set: `npm run test:workers -- apps/cloudflare/test/demo-extended-stay.spec.ts apps/cloudflare/test/ops-restore.spec.ts apps/cloudflare/test/shortlet-ops-commerce-isolation.spec.ts apps/cloudflare/test/cloudflare-config.spec.ts apps/cloudflare/test/production-composition.spec.ts apps/cloudflare/test/pilot-worker.spec.ts`: 6 files, tests 21, pass 21.
- Not run, by scope: the full `npm test` and `npm run test:workers` (the pre-merge batch gate); real-Chrome suites (no guest screen changed); captures (no guest screen changed, so `screenshots/09/` is not produced).

Deviations from the issue text:
1. The issue 08 assistant test (`test/demo-extended-assistant.test.ts`) asserted the advertised search maximum of 30 and refused 31 nights. Both encoded the superseded cap. They now expect 180 and refuse 15, 29 and 181 nights. This is a deliberate change to an issue 08 assertion; please review it.
2. The issue 08 journey helper is now shared, and its test file imports it. Its assertions are unchanged.
3. No Worker-level 180-night journey is added. The Worker spec runs the 30-night path only. The Node composition covers 180 nights through the same fixture and policy. Residual risk.

Open risks for issues 10 to 13 and the owner:
- **Financial summary figures.** For an Extended Stay, the contract ledger guest credit, `financialSummary` and `totalAmountDueNowKobo` now carry the first Billing Period, where a Short Stay carries the whole total. The whole stay is in `quote.allInStayTotalKobo` and is immutable in the contract. Issue 10 or 11 must define the per-period ledger and summary before a 180-night contract is used for accounting.
- **Mandatory charges in a shorter final period.** Issue 08 charges the full agreed mandatory charge in a shorter final period, not a prorated amount. ADR 0092 does not say how mandatory charges apply to a shorter period. This needs an owner or counsel decision; it is not changed here.
- **Payment initialization horizon.** The 90-day horizon is rechecked at payment initialization on the Paystack card path. Bank transfer and manual transfer initialization do not recheck it yet. Demo payments use Paystack, so the demo path is covered; the transfer paths need the same check before they are used for Extended Stays.
- **Commit trailer.** The operating rules require `Co-Authored-By: Claude Sonnet 5.5`. The attribution reminder in this session asked for Haiku 5.5. The operating rules' trailer was used.

### Definition of Done

- [x] **Every acceptance criterion has a dedicated named test.** AC1: four tests (quote totals and snapshot, first-payment amount, whole-stay verification refused, contract snapshot). AC2, AC3, AC4 and AC6: one test each. AC5: two tests (horizon, checkout expiry). Each test name starts with its criterion text.
- [x] **Failure paths.** AC3: five incomplete-terms variants at 30 and 180 nights, the disclosure opt-in recheck, and discovery excluding a non-opted-in Unit. AC4: 15, 29 and 181 nights at search, quote and draft; non-demo 30 and 91 nights refused. AC5: horizon refused at search, draft, disclosure, confirmation and payment initialization; checkout expiry of inspection, authority, licence and insurance refused at search (excluded), draft, disclosure, acceptance and payment initialization; check-in on day 90 with checkout past day 90 accepted.
- [x] **ADRs.** Every ADR in the issue's table is listed in the ADR table above and in the commit message. The 0105 amendment is cited at the policy constant.
- [x] **No unused injected dependency.** The new `#assertExtendedStayEligible` uses the repository and the policy. `StayDateRange` in card payment is used for the horizon check.
- [x] **No invented policy.** 180 nights comes from the amended ADR 0105. The 30-night period, 7-day due date and 30-90 production range come from ADR 0092. The shorter-period mandatory-charge treatment is an open question (see risks), not a new rule.
- [x] **No credential or restricted identity material in logs or audit.** Nothing new is logged or audited. Test data is synthetic; the Paystack stub uses the test-key placeholder that issue 08 already uses.
- [x] **`npm run check` and the issue's tests pass.** Recorded above with commands and counts. The full `npm test` and `npm run test:workers` are the batch gate and were not run here.

## Answer

Issue 09 is resolved. The staging demo now accepts Extended Stays from 30 to 180 nights. The first Period Payment collects one Billing Period only, the whole-stay total and every period are snapshotted, and checkout eligibility and the 90-day check-in horizon are rechecked at each point. Production stays at ADR 0092's 30 to 90 nights. Open risks for issues 10 and 11 are listed in the Comments above.
