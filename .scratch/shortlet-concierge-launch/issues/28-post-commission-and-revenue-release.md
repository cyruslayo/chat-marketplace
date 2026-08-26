# Post commission, Operator Net, and Revenue Release entries

Status: resolved
Type: AFK
User stories: 78–81, 89–90

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Calculate commission on Commissionable Operator Revenue, hold stay consideration through the Check-In Protection Window, and post one authoritative Revenue Release with Operator Net, platform commission, taxes, liabilities, and any risk hold represented in balanced financial records.

## Acceptance criteria

- [x] Standard, founding, and Preferred rates apply prospectively to the correct commission base and captured booking version.
- [x] Revenue becomes payable only after Verified Access plus 24 hours without an unresolved Blocking Fulfilment Complaint.
- [x] One launch Reservation creates at most one Revenue Release while corrections use explicit ledger adjustments.
- [x] Duplicate events, cancellation, refund, incident, and provider failure preserve financial balance and audit correlation.

## Blocked by

- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
- [Issue 16](16-verify-access-with-live-support.md)

## Answer

Productionized as an authoritative, backend-only Revenue Release path.

- `BookingStateRepository`, the real `RevenueReleaseCheckInAccessAdapter` over `CheckInSupportManager`, server clock, and exact authoritative `protectionWindowStartsAt` + 24-hour gate drive release; `verifiedAt` remains a separate historical fact and awaiting, failed, and human-review access states fail closed.
- Blocking Fulfilment Complaint state is composed from Check-In Support and the real `MidStayBlockingComplaintQuery`; trusted payment/fraud/compliance/refund/reversal holds, active Operator payment account, effective Checkout terms, and relocation consequence state are read-only authority gates.
- Captured commission rate and `adr-0062-launch-v1` policy version remain attached to the booking. Current amended Contract economics are used without retroactively changing the captured rate; Standard/Founding/Preferred are 12%/8%/10%.
- `RevenueAccountingRepository` atomically commits one immutable `revenue-release:<reservationId>`, a balanced kobo journal, and one durable earned-commission record; replay returns an existing authority-matching Release before consulting mutable providers. Later refunds, remedies, and provider corrections use canonical, correlated, discoverable, idempotent ledger adjustments and never rewrite the release.
- Fast Payout classifies 90% payable and 10% as a booking-specific Rolling Reserve tranche eligible for review after 30 days. Full Post-Stay has no routine reserve: 100% is deferred until 24 hours after authoritative effective Checkout. No payout transfer is performed.
- `shortlet.revenue-release/v1` is the truthful pre-release and immutable post-release projection for the conventional Operator route and Weaver A2UI Basic Catalog v0.9.1 adapter; actual adjustment records are summarized and no release or adjustment action is exposed.
- Issue 24 contribution/disbursement and Issue 30 trust-tier/reserve-release policy remain deliberately out of scope.

### Validation

Local validation: `npm run check` passed; `npm run verify:weaver` passed; full suite **422 passed, 0 failed, 0 skipped, 0 todo** (delta **0** from the accepted 422 baseline); `git diff --check` passed.

### ADR Compliance

ADR 0021, ADR 0024, ADR 0026 (superseding ADR 0025), ADR 0062, ADR 0072, ADR 0074, ADR 0075, ADR 0077, ADR 0080, and ADR 0081 are reflected in the authority gates, immutable release/accounting boundary, minimized artifact, command construction, and deterministic conventional/Weaver projections.

