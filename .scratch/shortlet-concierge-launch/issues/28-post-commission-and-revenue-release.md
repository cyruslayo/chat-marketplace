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

Implemented `RevenueReleaseManager` in `domains/shortlet/src/revenue-release.ts`.

### ADR Compliance
- **ADR 0021**: Net accommodation revenue and platform commission remain pending until 24 hours after Verified Access without an unresolved Blocking Fulfilment Complaint.
- **ADR 0024**: Exactly one Revenue Release per launch reservation; subsequent corrections/refunds use explicit ledger adjustments.
- **ADR 0026**: Payout plans (Fast Payout with 90% payable / 10% rolling reserve tranche vs Full Post-Stay Payout with 100% payable); balanced financial accounting.
- **ADR 0062**: Commission base includes accommodation and mandatory non-tax charges; excludes deposits and taxes. Rates: Standard 12%, Founding 8%, Preferred 10%.

