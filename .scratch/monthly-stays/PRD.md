# Monthly Stays PRD

Status: needs-triage
Requested: 3 Oct 2026

## Problem Statement

Lagos and Abuja have nothing in between a hotel and an annual lease. A consultant on a three-month assignment, or a new hire who has just moved to the city, can choose:
- a hotel, which is too expensive for months;
- a random shortlet, which is a gamble on power, water, security and fake listings;
- or a lease that demands one to two years' rent upfront, often before they know the city.

Owners have the opposite problem. Lagos has too many shortlets: Airbnb occupancy is about 43% and revenue per listing is falling. A guaranteed month at a discount beats a month of one-night gaps. About 24% of Lagos stays already run 30 nights or more, so demand exists. Nobody serves it with the trust this platform already provides: physical inspection, the All-In Stay Total, protected payment and human support.

Today the product cannot sell those stays. ADR 0023 caps every stay at fourteen nights. Its own text says extended stays need a separate design with Nigerian legal review, including dedicated contracts, pricing, payment and payout schedules, servicing, utilities, cancellation, deposits and support rules. This PRD is that design.

## Solution

Add an **Extended Stay**: a furnished, inspected Entire Place for 30 to 90 nights (ADR 0092), sold at a monthly all-in price and paid **one Billing Period at a time**, with no year upfront. It reuses the existing trust spine:
- Request to Book and Self-Booking;
- identity verification and Payer Attestation;
- Paystack card and transfer, and manual transfer;
- Human Incident Support at check-in;
- the mid-stay remedy matrix;
- the Owner Payable model in ADR 0089.

**Who it is for (decided 3 Oct 2026):**
- **Core segment 1: assignment professionals.** Consultants, auditors, NGO and project staff, and engineers who book for themselves and claim the cost back from their employer. They need a receipt the employer will accept.
- **Core segment 2: relocating people.** New hires, people between leases and families renovating. They need a furnished landing pad without paying a year upfront. A paid "house-hunt while you stay" service follows once the pilot shows demand.
- **Seasonal offer: the diaspora on long visits.** A time-boxed campaign each December–February, and optionally July–August. It uses the same units and monthly prices, plus optional extras. It is not a separate product.
- **Parked:** company or NGO payer accounts (these need an ADR 0012/0013 change), and industrial or rotational staff.

Positioning line (marketing copy, to be confirmed in issue 11): *"Your verified home for the months in between: assignments, relocations, house-hunts. Furnished, powered, one monthly price, no year upfront."*

## Sequencing

1. **Validate by hand first** (issue 01). Run 10 or more paid monthly stays using today's product plus written agreements.
2. **Get Nigerian legal review in parallel** (issue 02): whether an Extended Stay is a licence to occupy or a tenancy, and what receipts and VAT require.
3. **Decide the policy** (issue 03, ADR 0092). Only then is the code work (issues 04–12) unblocked.

No issue may set an Extended Stay value (length, period, notice, refund percentage, due date) that is not in ADR 0092 or `CONTEXT.md`.

## User Stories

### Guests: finding a monthly stay
1. As an assignment professional, I want to tell the concierge I need somewhere for two to four months, so that I only see units that accept Extended Stays for those dates.
2. As a relocating guest, I want to see the monthly all-in price, so that I can compare it with a hotel or a year's rent without doing arithmetic.
3. As a guest, I want each unit to state what the monthly price includes (power and generator fuel, water, internet, cleaning frequency), so that there are no surprise utility bills.
4. As a guest, I want to know before I request how payment works (first Billing Period now, later periods on fixed dates), so that I can plan my cash.
5. As a guest, I want the same trust facts as a Short Stay: inspection, management authority, area-level location and verified reviews.

### Guests: booking and paying
6. As a Primary Guest, I want to request an Extended Stay through the same Request to Book flow, so that the Operator confirms availability for the whole stay.
7. As a guest, I want to pay only the first Billing Period to confirm, with the whole stay's dates blocked.
8. As a guest, I want each later Billing Period to show its amount, due date and payment options, with reminders before it is due.
9. As a guest, I want a receipt for every Billing Period that names me, the stay dates covered, the amounts and the platform, so that my employer will reimburse me.
10. As a guest, I want to extend my stay by another period through a Booking Amendment, so that I don't have to rebook or move.

### Guests: during and ending the stay
11. As a guest, I want scheduled cleaning and a way to report a maintenance problem, so that a long stay stays livable.
12. As a guest, I want mid-stay failures (power, water, access, safety) handled under the existing remedy matrix.
13. As a guest, I want to end early by giving notice, and to know exactly what I owe and what comes back, so that a changed assignment doesn't cost me the rest of the stay.

### Owners and the back office
14. As the platform owner, I want to record each unit's monthly agreed amounts and margin, so that the monthly guest price comes from versioned unit configuration (ADR 0089).
15. As the platform owner, I want an Owner Payable for each Billing Period, so that owners are paid month by month as the guest pays.
16. As the platform owner, I want to see upcoming and overdue period payments by due date, so that I can contact guests before a period starts.
17. As an owner, I want my unit's Extended Stay terms (minimum stay, what's included, cleaning schedule) recorded as unit configuration, not agreed in chat.

### Seasonal offer
18. As a diaspora guest, I want a holiday package of a monthly stay plus optional airport pickup, SIM and driver days, so that I can arrange my visit in one place.
19. As the platform owner, I want to switch the seasonal offer on and off by date, so that it runs as a campaign.

## Implementation Decisions

- **New domain term, Extended Stay.** It sits beside the Short Stay and does not replace it. Short Stay remains 1–14 nights (ADR 0023 unchanged for Short Stays). The `CONTEXT.md` entry for Short Stay already tells writers to avoid "Extended stay, monthly stay", so the term is free to define. Issue 03 adds the glossary entries: Extended Stay, Billing Period, Period Payment, Period Owner Payable, Notice to End, Monthly Agreed Amounts.
- **The stay type is chosen by the stay length** and captured in the Stay Quote and Booking Contract snapshot. Existing Short Stay code paths (`MAX_STAY_NIGHTS` in `domains/shortlet/src/browse.ts`, the length checks in `booking-request.ts` and `booking-amendment.ts`) keep their behaviour. Extended Stay limits come from ADR 0092 configuration, not new literals.
- **The units must opt in.** A unit accepts Extended Stays only when its configuration says so and carries Monthly Agreed Amounts and a utilities and servicing statement.
- **Eligibility covers the whole stay.** Inspection (ADR 0056, ADR 0009), management authority (ADR 0057) and regulatory validity (ADR 0065) must extend through Contractual Checkout. A 6-month stay therefore needs an inspection completed less than 6 months ago.
- **Billing Periods.** The contract fixes every period's dates and amount at confirmation. The first Period Payment uses the existing Payment Window, Live Payment Attempt and payment methods (ADRs 0044, 0046, 0088, 0090) and forms the Booking Contract. Each later Period Payment is its own payment session with the same rules. ADR 0092 sets its due date and what happens if it is missed.
- **Owner payment.** The Owner Payable is captured per period at confirmation. Period 1 becomes due under ADR 0089's rule (24 hours after Verified Access, with no Blocking Fulfilment Complaint open). ADR 0092 sets the rule for later periods. `owner-payable.ts` is extended rather than duplicated.
- **Cancellation and Notice to End.** Before check-in, the stay follows a catalogue entry for Extended Stays, added to the ADR 0058 catalogue and approved by counsel (ADR 0014). After check-in, the guest may give a Notice to End under ADR 0092. ADR 0058's rule that leaving early refunds no unused nights is replaced for Extended Stays only.
- **Remedies.** ADR 0061 uses each night's contracted value. Every Billing Period is split into nightly contracted values in the contract snapshot so that remedies and the Cancellation Base stay deterministic.
- **Deposits.** These stay at zero for the pilot (ADR 0089). ADR 0092 records whether Extended Stays later need one.
- **Receipts** are produced from the ledger, never typed by hand. Their format and any VAT line follow issue 02's legal and tax answer.
- **Guest UI** uses the guest UI kit: chat and the standalone page render the same content from the same helper. Copy comes from `apps/web-agent/src/guest-content.ts`. Screens follow the AGENTS.md "Guest UI work" rules and ADR 0078.

## ADR compliance

| ADR | Constraint | Where it bites |
|---|---|---|
| 0023 | Short Stays are 1–14 nights; extended stays need a separate design and legal review | Issue 03 adds ADR 0092 for Extended Stays; Short Stays unchanged |
| 0006 | Operator or owner is the Accommodation Provider; the platform is marketplace and collection agent | Contract wording (issue 02); no master lease |
| 0012, 0013 | Self-Booking; the Primary Guest is the payer | Segment 1 books and expenses personally; company payer is out of scope |
| 0014, 0058 | Standard versioned cancellation catalogue, legally approved | New catalogue entry and Notice to End (issues 03, 08) |
| 0015 | All-In Stay Total everywhere, including utilities and mandatory charges | Monthly price and utilities statement (issue 05) |
| 0016, 0089 | Deposits optional; zero at launch | No deposit in the pilot |
| 0044, 0046, 0088, 0090 | Payment Window, one live attempt, methods | Every Period Payment (issue 06) |
| 0045 | Late money refunded, never confirms | Late period payments (issue 06) |
| 0055 | 90-day horizon applies to check-in | Unchanged; long stays may end after Day 90 |
| 0056, 0057, 0009, 0065 | Inspection, authority and regulatory validity through checkout | Extended Stay eligibility (issue 04) |
| 0060 | Versioned Booking Amendments | Extensions (issue 09) |
| 0061 | Remedies by nightly contracted value | Nightly breakdown of each period (issue 06) |
| 0030, 0031, 0032 | Human support at check-in; arrival 2–10 PM; checkout 11 AM | Unchanged |
| 0075 | No credentials or identity evidence in logs | Receipts, reminders and payment logs |
| 0078 | Accessible Nigerian launch profile | Guest screens (issue 11) |
| 0089 | Owner's Agreed Amounts plus margin; Owner Payable timing | Monthly amounts (05) and per-period payable (07) |

## Testing Decisions

- One named test per acceptance criterion, including every failure path named (see `docs/agents/issue-tracker.md`).
- The test clock drives Billing Period due dates, reminders and lazy expiry. `projectState` must evaluate period deadlines against the current clock (AGENTS.md anti-pattern 2).
- Existing Short Stay suites must stay green unchanged. That is the guard that Short Stays are untouched.
- Payment tests reuse `test/helpers/paystack-http.ts` and the existing deterministic local provider.
- Guest screens use `withStagePage` / `withRequestScreen` and end with captures at 320, 390, 768 and 1280 under `screenshots/<issue>/`.

## Out of Scope

- Company or NGO payer accounts and invoicing to a company (needs an ADR 0012/0013 change). This is revisited when the pilot produces repeat employers.
- Industrial and rotational staff, Port Harcourt, and Rwanda.
- Unfurnished month-to-month tenancy (ShortRent's model).
- Automatic recurring card charges or direct debit. Each period is a fresh payment under ADR 0046/0049.
- Automated owner payouts (ADR 0089 keeps them manual).
- Rent-now-pay-later financing.

## Further Notes

- **Pilot success signals (issue 01):**
  - 10 or more paid monthly stays;
  - 40% or more extend or rebook;
  - one referral for every three guests or better;
  - 2 or more inbound company or NGO admin requests;
  - 70% or more of owners renew.
- **Market evidence and sources:** see the approved positioning plan (`C:\Users\Cyrus\.claude\plans\so-this-application-is-fuzzy-gadget.md`).
  - [AirROI Lagos](https://www.airroi.com/airbnb-data/nigeria/lagos/lagos)
  - [Ghecs: monthly short lets](https://ghecs.com/blog/posts/monthly-short-let-apartments-lagos-guide)
  - [Nigeria Housing Market: supply pressure](https://www.nigeriahousingmarket.com/news/lagos-shortlet-boom-rising-supply-pressures-operators)
  - [Premium Times: Lagos tenancy bill](https://www.premiumtimesng.com/news/top-news/839588-what-new-lagos-tenancy-bill-means-for-landlords-tenants-and-agents-and-why-it-matters.html)
  - [Businessday: Detty December](https://businessday.ng/business-economy/article/us-uk-top-lagos-detty-december-arrivals-as-diaspora-spending-hits-n396bn/)
