---
status: accepted (4 Oct 2026), except the items marked [counsel], which await the Nigerian legal review in .scratch/monthly-stays/issues/02
---

# Offer Extended Stays paid one Billing Period at a time

> Items marked **[counsel]** are not in force. Code may implement the structure around them, but must not ship guest-facing behaviour that depends on them until counsel's answer is recorded here.

## Context

ADR 0023 limits launch stays to one through fourteen nights. It says longer stays need a separately designed capability, with Nigerian legal review, dedicated contracts, pricing, payment and payout schedules, servicing, utilities, cancellation, deposits, occupant changes and support rules.

The business has chosen furnished, verified monthly stays in Lagos and Abuja as its core offer (`.scratch/monthly-stays/PRD.md`):
- **assignment professionals**, who book and pay themselves and claim the cost back from an employer;
- **relocating people**, who need somewhere to live without paying a year upfront;
- and, as a seasonal offer only, **diaspora visitors on long stays**.

Owners will accept a monthly agreed amount below their nightly equivalent in return for a guaranteed stay. Guests will not pay a whole stay upfront. So the stay must be contracted at once but paid one period at a time.

## Decision

### The stay types

- An **Extended Stay** lasts **30 to 90** consecutive nights. Counsel may lower the maximum **[counsel]**.
- A **Short Stay** remains 1 to 14 nights under ADR 0023, unchanged.
- Stays of **15 to 29 nights** are not offered. The booking service rejects them before search, quoting, identity verification, inventory blocking or payment, as it does any unsupported length today. This is revisited after the pilot.
- The stay type is set by the length. It is captured in the Stay Quote and the Booking Contract snapshot.
- **Continuous Occupancy** (ADR 0023) is aggregated across both types:
  - adjacent Short Stays can never add up to more than fourteen nights;
  - the continuous occupancy that includes an Extended Stay can never exceed 90 nights.

### Units

- A unit offers Extended Stays only after it opts in. Opting in requires:
  - **Monthly Agreed Amounts**: the owner's agreed amount for a full Billing Period, plus any mandatory charges (ADR 0089);
  - **Owner's Agreed Amounts** for a single night, which the unit already has for Short Stays and which price a shorter final period;
  - a **utilities and servicing statement**: whether power and generator fuel, water and internet are included, and the cleaning frequency.
- A unit may set a **higher minimum** Extended Stay length (between 30 and 90 nights). It cannot lower the minimum below 30 or change the maximum.
- Inspection (ADR 0056, ADR 0009), Management Authority (ADR 0057) and regulatory validity (ADR 0065) must cover every night through Contractual Checkout. They are rechecked at search, draft, disclosure, confirmation and payment initialisation (ADR 0055).
- The 90-day Booking Horizon still applies to check-in only (ADR 0055).

### Price

- **Full Billing Period.** The guest price is the Monthly Agreed Amounts plus the unit's margin.
- **Shorter final period.** Each night is priced at the unit's nightly Owner's Agreed Amounts plus margin, the same price a Short Stay night would have. A shorter final period earns no monthly discount.
- **All-In Stay Total.** The total for the stay is the sum of its periods (ADR 0015, ADR 0089).
- **Utilities.** Those in the unit's statement are included in the price. There are no metered or separately billed utilities.
- **Nightly contracted value.**
  - A full period's amount is split into nightly contracted values in kobo: the amount divided by its 30 nights, with any remainder added to the last night.
  - A shorter final period's nightly contracted values are its nightly prices.
  - These values are snapshotted. ADR 0061 remedies, the Cancellation Base and Notice to End refunds all use them.
- **Price changes.** A change to a unit's agreed amounts or margin affects only new quotes. Confirmed periods are never repriced.

### Billing Periods and Period Payments

- **Billing Periods.** The stay is divided into consecutive **Billing Periods of 30 nights**, counted from check-in; the last may be shorter. The Booking Contract fixes every period's dates, amount, nightly values and due date at confirmation.
- **First Period Payment.** This is paid through the existing payment flow:
  - Payment Window and Payment-Processing Grace (ADR 0044);
  - one Live Payment Attempt (ADR 0046);
  - card or Paystack transfer (ADR 0088), or manual transfer within its hours (ADR 0090);
  - Payer Attribution (ADR 0013).

  Its verification forms the Booking Contract, confirms the Reservation, and blocks every night of the stay.
- **Later Period Payments.**
  - Each later period becomes **payable once the previous period has started**. A guest can never pay more than one period ahead.
  - It is **due 7 days before its first night**.
  - Each attempt is a fresh payment session under the same rules: unique reference, one live attempt, backend verification and Payer Attribution. Recurring charges and saved cards are not used (ADR 0049).
- **Reminders** go to the Primary Guest **7, 3 and 1 days** before a due date. They contain no credentials, account numbers or identity evidence (ADR 0075).
- **Missed payment.**
  - A period with no verified payment at its due date is **overdue**. The back office must contact the guest.
  - If it is still unpaid when the period's first night begins, the stay ends at the checkout following the last paid night, by the lawful process counsel sets **[counsel]**.
  - The platform and the owner never lock out the guest, change access, or remove belongings as a payment remedy.
  - Overstay after that checkout follows the existing overstay rules.
- **Late money.** Money for a period that has already ended under the rule above is recorded and refunded in full, and never revives the stay (ADR 0045).
- **Lazy evaluation.** Period states (scheduled, payable, due, paid, overdue, ended) are projected from the clock, not set by a background job.

### Paying owners

- **One Period Owner Payable per Billing Period** is captured at confirmation and never recalculated (ADR 0089).
- **Period 1** is due 24 hours after Verified Access, with no Blocking Fulfilment Complaint open (ADR 0089).
- **Each later period** is due when its Period Payment is verified and its first night has begun, with no Blocking Fulfilment Complaint open.
- **No payable for unpaid periods.** A period that is never paid, or ended by cancellation or Notice to End, has no payable for the nights not provided.
- **Margin.** The margin for a period is earned when that period's payable becomes due.
- **Payouts** stay manual and are recorded per period (ADR 0089). The Owner Overpayment rule applies per booking.

### Cancellation before check-in

- The cancellation catalogue (ADR 0014, ADR 0058) gains an **Extended** entry, used by every Extended Stay. It is measured from the start of the Contractual Check-In Window.
- **Refunds:**
  - 100% of the first period's Cancellation Base is refunded when the guest cancels by **T-30d**;
  - 50% is refunded by **T-14d**;
  - after that, the base is retained.

  These thresholds are decided but need counsel's approval before publication (ADR 0014) **[counsel]**.
- **Later periods** are never charged by a cancellation before check-in.
- **Overrides.** Operator failure, platform failure, unsafety, illegality and non-excludable rights override the entry, as for every policy.

### Notice to End

- After Verified Access the Primary Guest may give a **Notice to End**.
- The new last night is the night before the date **14 days after the notice**. It never falls after the contracted checkout. The 14 days are decided but need counsel's approval **[counsel]**.
- **Paid nights after the new last night** are refunded at their nightly contracted values. **Unpaid nights up to it** are owed as their nightly contracted values, not as a full period.
- **Recording.** The notice is recorded as a versioned Booking Amendment (ADR 0060). The original contract stays authoritative until the amendment commits.
- **Owner Payables** fall by the owner's share of the refunded nights.
- **Replaces ADR 0058's no-refund rule.** For Extended Stays only, this rule replaces ADR 0058's "no automatic unused-night refund for voluntary early departure". A departure caused by a failure follows ADR 0061 instead.

### Extensions

- A guest may extend through a Booking Amendment (ADR 0060). The extension adds one or more Billing Periods, and the last may be shorter, priced as above.
- It requires:
  - availability;
  - a fresh quote at the current agreed amounts;
  - Request to Book approval;
  - inspection and authority validity through the new checkout;
  - a total length of at most 90 nights.
- Existing periods are unchanged. Extensions are never agreed in chat or off-platform (ADR 0023).

### Deposits

Extended Stays carry a zero Refundable Security Deposit in the pilot (ADR 0089, ADR 0016). This is revisited with pilot data.

### Servicing and failures

- **Cleaning.** The cleaning schedule follows the unit's statement, as captured in the contract.
- **Utility failures.** A failure of an included utility is an amenity failure under ADR 0061.
- **Incidents.** Maintenance reports join the single incident record (ADR 0030).

### Contract and wording

- **The parties.** ADR 0006 stands: the owner or operator is the Accommodation Provider, and the platform is marketplace and collection agent.
- **Contract wording.** The Booking Contract for an Extended Stay uses counsel's **licence to occupy** wording **[counsel]**.
- **Guest-facing wording** never calls the stay a tenancy or lease, the price rent, the owner a landlord, or the guest a tenant.

### Receipts

Every verified payment produces one receipt from the ledger. The fields, any tax lines and the refund correction document are as counsel specifies **[counsel]**.

### Unchanged for Extended Stays

- Request to Book.
- Self-Booking and the payer rule (ADR 0012, ADR 0013). Company payers are out of scope.
- Identity verification.
- Arrival from 2 PM to 10 PM (ADR 0031) and checkout at 11 AM (ADR 0032).
- Human Incident Support through the check-in window (ADR 0030).

## Status of earlier decisions

| ADR | Effect |
|---|---|
| 0023 | Unchanged for Short Stays. Its deferred "extended stays" capability is defined here. Continuous Occupancy aggregation now spans both types. |
| 0058 | Extended: adds the Extended catalogue entry. For Extended Stays only, Notice to End replaces the no-refund rule for voluntary early departure. |
| 0089 | Extended: Monthly Agreed Amounts, and one Period Owner Payable per Billing Period with the due rule above. Period 1 keeps ADR 0089's rule. |
| 0044, 0046, 0088, 0090 | Unchanged; they apply to every Period Payment. |
| 0014, 0015, 0055, 0056, 0057, 0060, 0061 | Unchanged; applied to Extended Stays as described. |

## Consequences

- The back office gains a due-date list of payable and overdue Period Payments, and must contact guests before overdue periods start.
- Each confirmed Extended Stay blocks a unit for up to 90 nights on the first period's payment alone. A missed later payment frees the remaining nights only after the lawful process. Owners accept this risk in their Extended Stay terms.
- Inspections must cover the whole stay. A unit inspected 10 months ago can take an Extended Stay of at most about 2 months.
- Stays of 31–59 and 61–89 nights end with a shorter period at the nightly price, so the best value is in whole 30-night periods. Guest screens must show this before the request.
- Booking 30 days or less before check-in means the guest is already past the full-refund threshold. The request review must say so.
- Short Stay code paths and tests stay as they are. Extended Stay limits are configuration, not new constants beside `MAX_STAY_NIGHTS`.

## Pending counsel (issue 02)

1. Whether the 90-night maximum is safe as a licence to occupy.
2. The lawful process when a later period is unpaid.
3. Approval of the T-30d / T-14d cancellation thresholds and the 14-day notice.
4. Licence-to-occupy contract wording.
5. Receipt fields, tax lines and the correction document.
