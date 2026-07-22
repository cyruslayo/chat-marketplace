# Shortlet Booking

The first Concierge Platform reference domain, enabling verified accommodation operators in Lagos and Abuja to publish shortlets and guests to discover, quote, and book them.

## Participants

**Operator**:
A verified legal entity with documented authority to manage and provide accommodation at one or more shortlet properties.
_Avoid_: Merchant, host, vendor

**Accommodation Provider**:
The verified operator that contracts with the guest and is responsible for providing a particular stay.
_Avoid_: Seller of record, platform, property name

**Property Owner**:
The person or entity holding an ownership interest in a property, who is not necessarily its operator or the guest's accommodation provider.
_Avoid_: Operator, accommodation provider

**Management Authority**:
Documented, property-specific authority permitting an operator to offer shortlet accommodation, contract with guests, collect revenue, and perform the agreed operational responsibilities.
_Avoid_: Property access, verbal permission, operator approval

**Guest**:
A person seeking or holding a shortlet reservation, whether or not they initiated the booking conversation.
_Avoid_: Consumer, customer, user

**Primary Guest**:
The verified adult who submits the booking request, accepts the booking contract, and is responsible for the declared guest party.
_Avoid_: Payer, account holder, additional occupant

**Additional Occupant**:
A declared member of the guest party for whom the primary guest remains responsible and who is not routinely identity-verified at launch.
_Avoid_: Primary guest, unregistered guest

**Self-Booking**:
A reservation in which the verified primary guest is also the person making the booking and personally occupies the unit.
_Avoid_: Third-party booking, gift booking, corporate booking

**Primary Guest Attestation**:
The primary guest's versioned declaration that they are making a Self-Booking and will personally occupy the unit.
_Avoid_: Chat inference, occupant name

**Payer Attestation**:
The primary guest's versioned declaration that the payment method used for the reservation is attributable to them.
_Avoid_: Proof of payer identity, payment authorization

## Supply

**Property**:
A verified accommodation location managed by an operator and containing one or more bookable units.
_Avoid_: Listing, unit

**Unit**:
A specific, self-contained apartment or house with its own calendar, pricing, and reservation history, reserved exclusively for one guest party for the full stay.
_Avoid_: Property, room

**Entire Place**:
An occupancy model granting one guest party exclusive use of a self-contained unit, including its sleeping and bathroom areas, but not necessarily shared building or estate facilities.
_Avoid_: Private apartment, shared room, room category

**Short Stay**:
A reservation or aggregated continuous occupancy at one property lasting between one and fourteen consecutive nights under the launch product.
_Avoid_: Extended stay, monthly stay, tenancy

**Continuous Occupancy**:
Adjacent or operationally continuous accommodation at the same property by the same primary guest or materially the same guest party, aggregated across units and reservations for stay-length enforcement.
_Avoid_: Separate stay, booking count

**Booking Horizon**:
The rolling local-calendar period in which a unit accepts check-in dates, capped platform-wide at 90 days and optionally narrowed per unit.
_Avoid_: Availability Calendar, stay length, checkout horizon

## Trust

**Physical Inspection**:
A dated, in-person assessment confirming a unit's existence, entire-place boundary, observable listing accuracy, basic guest readiness, and demonstrated operator control at that time.
_Avoid_: Fully verified, safety certification, ownership verification, platform guarantee

**Material Unit Change**:
A change or credible event that makes the facts established by a unit's last physical inspection unreliable and therefore requires reinspection.
_Avoid_: Cosmetic update, routine maintenance

**Verification Claim**:
A specific, evidence-backed assertion about an operator, property, or unit, maintained independently from other assertions and capable of expiring or being revoked.
_Avoid_: Verified badge, platform approved

**Guest Identity Verification**:
The platform's reusable assurance that the primary guest's government identity and minimum age have been verified, without disclosing raw identity evidence to an operator.
_Avoid_: Contact verification, operator ID check

**Payer Attribution**:
The platform's channel-specific assessment of whether a received payment is reasonably attributable to the verified primary guest.
_Avoid_: Payment success, exact-name match, payer attestation

**Availability Calendar**:
The authoritative record of whether a unit may be requested or held for particular stay dates.
_Avoid_: Social post, operator message

**Operator Block**:
An authoritative unit/date exclusion created for an off-platform booking, owner use, maintenance, or another valid operator-controlled reason.
_Avoid_: External booking record, conversational note, tentative enquiry

**Operator Hold**:
A 45-minute unit/date exclusion for a genuine external enquiry, extendable once by 15 minutes before conversion to an Operator Block or automatic release.
_Avoid_: Booking, indefinite block, platform booking request

**Open Dates**:
Dates the availability calendar currently permits a guest to request, but which an operator has not yet confirmed.
_Avoid_: Available, confirmed

## Booking

**Stay Quote**:
A time-bounded, deterministic price breakdown for a specified unit, date range, guest party, fees, and applicable policies.
_Avoid_: Estimate, nightly rate

**All-In Stay Total**:
The complete non-refundable cost required to book a specified stay, including accommodation and every unavoidable fee, tax, and charge.
_Avoid_: Base rate, nightly rate, amount due now

**Refundable Security Deposit**:
A separately disclosed refundable amount collected or authorized against defined guest-caused loss or damage and excluded from the All-In Stay Total.
_Avoid_: Stay cost, operator revenue, damage charge

**Security Deposit Claim**:
An operator's timely, evidence-backed request for reimbursement from a booking's security deposit for a permitted, objectively assessable guest-caused loss.
_Avoid_: Automatic deduction, penalty, operator invoice

**Balance of Evidence**:
The internal adjudication standard under which an operator must make every required element of a security-deposit claim more likely than not; an evidential tie favors the guest.
_Avoid_: Beyond reasonable doubt, guest burden, operator allegation

**Claim Response Window**:
The 48 elapsed hours beginning only after successful guest notification of a validated security-deposit claim, during which the guest may explicitly accept or dispute it.
_Avoid_: Two business days, time since claim submission

**Successful Claim Notification**:
Availability of the claim in the guest's authenticated account together with positive delivery evidence through an approved channel, or the guest's direct viewing of the claim.
_Avoid_: Message sent, API accepted, delivery attempted

**Claim Appeal**:
One party's single, time-bounded request for an independent human review of a security-deposit decision based on a defined appeal ground.
_Avoid_: New claim, repeated reconsideration, external complaint

**Internal Finality**:
The point at which the platform's ordinary claim and appeal process has concluded and its allocation may proceed to settlement, without limiting external or exceptional remedies.
_Avoid_: Paid, legal finality, waiver of consumer rights

**Amount Due Now**:
The immediate payment or authorization requirement comprising the All-In Stay Total, any upfront security deposit, and guest-selected optional extras.
_Avoid_: Stay total, nightly rate

**Operator Net**:
The operator's booking-level accommodation revenue after commission, operator-borne fees, tax withholding, refunds, and booking adjustments, excluding deposits and platform-owned amounts.
_Avoid_: Gross booking value, payout, available balance

**Revenue Release**:
The single booking-level event making Operator Net payable and platform commission earned after the protection window and all release conditions pass.
_Avoid_: Payout, transfer, settlement

**Rolling Reserve**:
A restricted portion of an operator's earnings maintained under a selected or assigned payout plan to cover defined operator liabilities.
_Avoid_: Guest security deposit, platform revenue, escrow, insurance

**Reserve Tranche**:
The traceable reserve contribution arising from one booking's Operator Net, with its own policy version, eligibility date, and disposition.
_Avoid_: Undifferentiated balance, operator penalty

**Payout Plan**:
A versioned set of operator settlement timing and reserve terms selected by an eligible operator or assigned for elevated risk.
_Avoid_: Revenue Release, payout preference without risk terms

**Operator Trust Tier**:
A performance-based classification derived from observed marketplace reliability and used to determine eligibility for improved commercial and operational terms.
_Avoid_: Paid status, reputation claim, permanent entitlement

**Guest Protection Fund**:
An internally restricted pool of platform capital used to provide prompt eligible guest remedies while delayed operator or PSP recovery proceeds.
_Avoid_: Guest money, operator reserve, escrow, insurance, guarantee

**Comparable Replacement**:
A platform-approved Entire Place for the same stay that meets the guest's disclosed essential requirements without additional guest cost or material deterioration in location, capacity, quality, access time, or trust status.
_Avoid_: Any available unit, operator substitution, cheaper property

**Relocation Remedy**:
A guest-approved replacement stay, including reasonable failure-caused transport and price difference, provided instead of refund after an eligible operator failure.
_Avoid_: Forced substitution, automatic upgrade, double recovery

**Refund Fallback**:
The firm entitlement to a full original-source refund when an eligible failed stay is not replaced through a promptly available and approved Relocation Remedy.
_Avoid_: Platform credit, conditional refund, relocation refusal penalty

**Active Check-In Window**:
The contractual arrival period for a confirmed reservation together with the operational support buffer during which authorized human incident coverage is required.
_Avoid_: Property opening hours, general support hours

**Contractual Check-In Window**:
The booking-specific interval in West Africa Time during which the guest may complete first access, constrained to the platform's 2:00 PM–10:00 PM launch boundary.
_Avoid_: Single check-in timestamp, anytime arrival

**Contractual Checkout**:
The booking's standard 11:00 AM West Africa Time return-of-possession deadline, or a later time established by an accepted checkout amendment.
_Avoid_: Physical departure, housekeeping estimate, operator message

**Checkout Amendment**:
A structured, operator-approved and guest-accepted change to Contractual Checkout, with availability, support coverage, price, and downstream deadlines revalidated.
_Avoid_: Informal late checkout, chat promise

**Late Checkout**:
A Checkout Amendment to 12:00 PM, 1:00 PM, or 2:00 PM WAT, available only when no reservation begins at the unit on the same date.
_Avoid_: Overstay, arbitrary departure time, operator extension

**Same-Day Turnover**:
A unit-level capability allowing a new Contractual Check-In Window on the date a prior reservation reaches Contractual Checkout.
_Avoid_: Operator-wide capability, default availability

**Turnover Plan**:
The approved unit-specific cleaning, inspection, access-preparation, staffing, timing, checklist, and escalation arrangement required for Same-Day Turnover.
_Avoid_: Generic operator procedure, readiness checkbox

**Turnover Run**:
A platform-observed execution of a unit's complete post-checkout cleaning, inspection, utility verification, and access-preparation process against its proposed Turnover Plan.
_Avoid_: Completed cleaning, checklist submission, guest stay

**Readiness Deadline**:
The point 30 minutes before an approved unit's incoming same-day Check-In Window by which acceptable evidence must establish readiness for arrival.
_Avoid_: Contractual check-in, estimated cleaning completion

**Ready for Arrival**:
The platform-established state that turnover, inspection, essential utilities, material amenities, and tested access satisfy the Turnover Plan for an incoming booking.
_Avoid_: Operator ready click, cleaning complete, evidence submitted

**Turnover Suspension**:
The temporary removal of a unit's Same-Day Turnover capability pending human classification, remediation, and proportionate restoration evidence.
_Avoid_: Booking cancellation, unit delisting, automatic timeout

**Turnover Revocation**:
The removal of a unit's Same-Day Turnover capability for the remainder of launch after repeated serious or egregious failure.
_Avoid_: Suspension, permanent unit ban

**Human Incident Support**:
Authorized platform responders who can own check-in failures, block revenue, approve bounded remedies, escalate safety issues, and suspend inventory during every Active Check-In Window.
_Avoid_: AI concierge, message-taking service, next-business-day support

**Booking Request**:
A verified guest's request that, once revalidated and successfully disclosed during Operator Active Hours, exclusively blocks a unit and overlapping dates for 30 minutes while the operator confirms or declines.
_Avoid_: Booking, hold, reservation

**Request Draft**:
An undisclosed guest intention prepared outside operator response or before revalidation that blocks no inventory and promises neither price nor availability.
_Avoid_: Booking request sent, dates held

**Operator Active Hours**:
The mandatory 8:00 AM–8:00 PM WAT daily schedule during which an authorized primary or backup operator responder receives and answers Booking Requests and routine operational contacts.
_Avoid_: Property check-in window, staff online indicator

**Technical Delivery Window**:
The maximum five minutes during which a validated Booking Request temporarily blocks inventory while supported channels attempt operator-notification acceptance.
_Avoid_: Operator response window, read receipt, request hold

**Latest Disclosure Cutoff**:
The instant three hours before a unit's Contractual Check-In Window begins, after which no new Booking Request may reach Pending Operator for that arrival.
_Avoid_: Payment deadline, request creation cutoff, manual override

**Booking Hold**:
A time-limited exclusion of a unit and date range while an instant-book guest completes payment.
_Avoid_: Reservation, booking request

**Reservation**:
A confirmed agreement for a guest party to occupy a unit for a specified date range under captured price and policy terms.
_Avoid_: Booking request, hold

**Request to Book**:
A booking mode in which an operator must confirm availability before the guest is invited to pay.
_Avoid_: Instant book

**Confirmed Availability**:
An operator's time-limited commitment that a requested unit and date range may proceed to payment at the quoted terms.
_Avoid_: Open dates, reservation

**Conditional Booking Offer**:
The complete, time-limited terms offered after an operator confirms availability and before the guest accepts and pays.
_Avoid_: Reservation, booking confirmation

**Payment Window**:
The 20 minutes after operator confirmation during which the guest may initiate and complete the designated payment while inventory remains exclusively blocked.
_Avoid_: Payment-processing grace, operator response window

**Payment-Processing Grace**:
One additional 10-minute inventory block granted only when a designated pre-deadline transaction is independently confirmed by the PSP as genuinely processing.
_Avoid_: Extra customer decision time, payment retry window

**Live Payment Attempt**:
The single designated PSP transaction for a booking that can still complete and therefore exclusively owns confirmation and grace eligibility.
_Avoid_: Checkout tab, payment-method selection, guest cancellation request

**Expiring Bank Transfer**:
A one-booking, amount-bound bank-transfer reference that the PSP makes non-payable at the Payment Window deadline.
_Avoid_: Dedicated customer account, persistent virtual account, saved bank details

**Fresh Card Checkout**:
A newly initialized, booking-specific PSP-hosted card transaction in which the platform neither handles raw card data nor persists a reusable authorization.
_Avoid_: Saved card, card on file, reusable token, direct card API

**Booking Contract**:
The agreement formed between a guest and accommodation provider when the guest has accepted the conditional booking offer, payment has been verified, and the reservation is committed.
_Avoid_: Booking request, operator confirmation, payment callback

**Verified Access**:
The platform's evidence-backed determination that the primary guest obtained the agreed unit or that valid access was provided as agreed when the guest voluntarily arrived late.
_Avoid_: Scheduled check-in, operator assertion, reservation confirmation

**Check-In Protection Window**:
The 24 hours after Verified Access during which operator revenue and platform commission remain unearned while blocking fulfilment complaints may be raised or investigated.
_Avoid_: Cancellation window, limit on guest rights

**Blocking Fulfilment Complaint**:
A credible access, availability, substitution, habitability, safety, authority, or material-accuracy complaint that prevents operator revenue from becoming payable pending review.
_Avoid_: Preference complaint, ordinary support request

**Cancellation Policy**:
A platform-defined, versioned set of deterministic guest-cancellation rules selected for a unit and captured immutably when a booking request begins.
_Avoid_: Operator custom terms, refund policy, case-by-case policy

**Cancellation Entitlement**:
The minimum monetary refund due to a guest under the captured cancellation policy and any overriding legal or failure-based remedy.
_Avoid_: Operator offer, platform credit

**Cancellation Liability**:
The attributed cause of a cancellation—guest policy, operator failure, platform failure, force-majeure review, or legal override—which determines the applicable remedy and funding responsibility.
_Avoid_: Cancellation reason, refund status

**Cancellation Base**:
The part of booking consideration to which a cancellation percentage applies: nightly accommodation and mandatory charges that reserved unit capacity, excluding the security deposit, unprovided services, and refundable taxes or levies.
_Avoid_: Total paid, All-In Stay Total

**No-Show**:
A human-confirmed booking state reached at 10:00 AM WAT on the day after arrival was due, after the guest has neither obtained Verified Access nor responded to required contact attempts.
_Avoid_: Late arrival, missed check-in message

**Booking Amendment**:
A versioned, mutually accepted change to material Booking Contract terms that becomes authoritative only after all required availability, risk, payment, and operational checks succeed.
_Avoid_: Chat agreement, profile edit, operator promise

**Mid-Stay Failure**:
An operator- or property-attributable defect arising during occupancy whose contractual remedy is determined from its severity, duration, effect on use, and cure.
_Avoid_: Guest preference, ordinary support request

**Commissionable Operator Revenue**:
The operator consideration on which platform commission is calculated, excluding security deposits, damage recoveries, refundable taxes, and other non-revenue amounts.
_Avoid_: Gross Booking Value, Operator Net, Amount Due Now

**Verified-Stay Review**:
The single review the Primary Guest may submit after a paid booking reaches completed-stay status with Verified Access.
_Avoid_: Imported testimonial, operator endorsement, unverified rating

**Instant Book**:
A booking mode in which authoritative availability permits a timed hold and automatic confirmation after verified payment.
_Avoid_: Request to book
