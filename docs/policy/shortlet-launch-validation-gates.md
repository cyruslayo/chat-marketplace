# Shortlet Launch Validation Gates

The product and domain-policy grilling is closed through ADR-0067. The items below are evidence gates, not open product-design decisions. Launch values remain provisional until the applicable gate is satisfied.

## Gates

1. **PSP selection and contracting** — validate settlement, refund, transfer-reference expiry, payment verification, webhook, reconciliation, and failure-handling capabilities.
2. **Payment-channel certification** — certify each exposed payment capability under production-equivalent timing and failure conditions before guest use.
3. **Identity and privacy readiness** — complete the future check-in identity and access data-flow review, retention controls, and required DPIA before processing launch identities. Booking does not require online Guest Identity Verification under ADR-0085.
4. **Nigerian legal and tax review** — validate contracting structure, consumer terms, cancellation and remedy rules, tax treatment, withholding, data protection, and marketplace obligations.
5. **Insurance placement** — confirm available policy wording, exclusions, limits, evidence requirements, and claims process before making insurance a launch condition.
6. **Operator validation** — test onboarding burden, response windows, cancellation catalogue, commission, reserves, deposits, and enforcement with prospective Lagos and Abuja operators.
7. **Unit-economics validation** — model payment costs, refunds, support, inspection, relocation, fraud, reserves, taxes, and Guest Protection Fund exposure against expected booking mix.
8. **Operational simulations** — rehearse request-to-book, payment expiry, same-day arrival, failed access, relocation, mid-stay failure, cancellation, no-show, deposit claim, overstay, and support handoff.

## Provisional Until Validated

- Commission rates and founding-operator period
- Insurance limits
- Security-deposit caps
- Guest Protection Fund seed, contribution rate, and target balance
- Relocation approval and reimbursement limits
- Payout trust-tier thresholds
- Tax and withholding treatment

Failure of a gate must reopen only the affected policy or value; it does not implicitly reopen the full launch model.

## Pilot Guest contact

The pilot stores a Guest-supplied Nigerian mobile number as the primary booking-coordination contact and a Guest-supplied email address as the secondary contact and future Paystack payment email. A valid phone number is required only when a Request Draft is submitted as a Booking Request. Email is required only before payment continuation. Neither value is identity verification, authentication, authorization, or proof of ownership; no OTP, email verification, or communications automation exists.

An authorized Operator representative may view the phone snapshot on the Booking Request detail surface under ADR-0082 and ADR-0086. Request lists omit contact data, and Guest email is not disclosed to Operators. Raw contact values are excluded from telemetry, general logs, audit metadata, URLs, and unrelated A2UI metadata.
