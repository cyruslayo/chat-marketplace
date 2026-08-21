# Concierge Platform and Verified Shortlet Launch PRD

Status: ready-for-agent

## Problem Statement

Guests seeking short stays in Lagos and Abuja face fragmented inventory, misleading prices, uncertain operator authority, unreliable availability, inconsistent property quality, unsafe payment practices, weak remedies, and support that often disappears when arrival or an active stay goes wrong. Operators likewise lack a trusted, structured channel for qualifying guests, managing time-sensitive Booking Requests, coordinating availability, proving readiness, receiving protected payment, and resolving incidents without uncontrolled off-platform negotiation.

The product must solve those problems without becoming the contractual Accommodation Provider, holding raw payment credentials, treating a conversational agent as the system of record, or coupling the business to one frontend framework or messaging channel. It also needs to establish a reusable Concierge Platform whose infrastructure and extension points can support later Domain Packs without flattening distinct business models into a generic transaction abstraction.

## Solution

Build a domain-extensible Concierge Platform and launch its first Domain Pack as a verified, Request-to-Book shortlet service for inspected entire-place stays in Lagos and Abuja. Registered Operators remain the contracting Accommodation Providers. The platform supplies trustworthy discovery, All-In Stay Totals, identity and payer controls, authoritative availability, protected payment workflows, Booking Contracts, incident support, guest remedies, deposit adjudication, operator settlement, enforcement, and auditable human decisions.

The complete transactional experience is available through an authenticated web application. WhatsApp provides bounded discovery, structured operational actions, notifications, triage, and Human Handoff; Instagram provides acquisition and secure referral only. Application services, domain state machines, policies, ledgers, and audit records remain authoritative across every channel.

Canonical Interaction Artifacts drive the web presentation: approved declarative surfaces use A2UI v0.9.1, with Weaver as the current replaceable Web Agent Adapter/runtime boundary. Authoritative application and domain state remains outside Weaver; material and consequential actions reach trusted application authority through Platform Command Envelopes. Conventional deterministic routes remain available for every material workflow, preserving Deterministic Parity when the presentation runtime is unavailable.

## User Stories

### Guests — discovery and trust

1. As a guest, I want to search inspected entire-place stays in Lagos or Abuja, so that I do not have to assess unsafe or unsuitable inventory myself.
2. As a guest, I want results limited to eligible Units with current Physical Inspection and Management Authority through checkout, so that a booking cannot depend on expired trust claims.
3. As a guest, I want to search by dates, party size, location, amenities, price, and stay requirements, so that results fit my actual trip.
4. As a guest, I want every discovery surface to show the All-In Stay Total, so that mandatory charges are not revealed late.
5. As a guest, I want the platform to rank organic results by fit, value, current verification, availability, fulfilment reliability, response performance, readiness, and Verified-Stay Reviews, so that useful and trustworthy Units surface first.
6. As a guest, I want sponsored placement excluded at launch, so that payment for visibility does not secretly distort ranking.
7. As a guest, I want specific Verification Claims and reliability metrics instead of a vague badge, so that I can understand what the platform actually verified.
8. As a guest, I want one review per completed paid stay with Verified Access, so that ratings represent real stays.
9. As a guest, I want neighbourhood-level location and an approximately 750-metre-obscured map before booking, so that I can assess fit without exposing the Unit prematurely.
10. As a guest, I want the full address only after confirmed payment and access instructions only when disclosure policy permits, so that property security is protected without surprising me.
11. As a guest, I want listing facts, House Rules, Cancellation Policy, deposit, support boundaries, and material restrictions shown outside chat, so that important commitments remain reviewable.
12. As a guest, I want to compare approved Units in a structured surface, so that I can understand price, sleeping arrangements, amenities, policies, and trust differences.

### Guests — eligibility and booking

13. As a guest, I want to create a Request Draft without blocking inventory, so that I can explore before making a commitment.
14. As a Primary Guest, I want clear notice that I must occupy the Unit and cannot book for someone else, so that identity responsibility is unambiguous.
15. As a Primary Guest, I want to complete government-ID verification before my Booking Request is disclosed, so that Operators receive qualified requests.
16. As a Primary Guest, I want the platform to support a distinct authorized payer only under the approved Nigerian-market attestation controls, so that legitimate assistance does not become unrestricted third-party booking.
17. As a guest, I want every overnight occupant named and capacity-checked, so that occupancy terms are clear before contracting.
18. As a guest, I want stays limited to one to fourteen consecutive nights and check-in within the rolling 90-day horizon, so that launch inventory remains operationally manageable.
19. As a guest, I want same-day booking through the ordinary verified workflow before the Latest Disclosure Cutoff, so that urgency does not weaken protections.
20. As a guest, I want a disclosed Booking Request sent only during Operator Active Hours and at least three hours before check-in begins, so that the Operator has a realistic fulfilment opportunity.
21. As a guest, I want the Operator to receive a successfully delivered request within five minutes, so that a technical delay does not consume the response window.
22. As a guest, I want a clear 30-minute Operator response deadline during declared hours, so that I am not left waiting indefinitely.
23. As a guest, I want inventory exclusively blocked while my disclosed Booking Request is live, so that another customer cannot take the same dates.
24. As a guest, I want a Conditional Booking Offer to capture the Unit, dates, occupants, price, policy versions, deposit, deadlines, and parties, so that I know exactly what I may accept.
25. As a guest, I want to pay the full booking amount through one verified launch payment flow, so that confirmation is deterministic.
26. As a guest, I want a 20-minute Payment Window and one ten-minute processing grace period, so that technical verification can finish without silently extending inventory beyond 30 minutes.
27. As a guest, I want only one Live Payment Attempt, so that duplicate charges and conflicting references are avoided.
28. As a bank-transfer guest, I want a booking-specific, amount-bound reference that becomes non-payable at expiry, so that late money cannot create ambiguous inventory rights.
29. As a card-paying guest, I want a fresh PSP-hosted checkout with issuer- and PSP-risk-based authentication, so that the platform never stores my reusable card authority.
30. As a guest, I want USSD shown only after Payment Capability Certification, so that an advertised method actually satisfies booking expiry and verification rules.
31. As a guest, I want any successful payment verified after inventory release automatically refunded without forming a Booking Contract, so that late money cannot capture unavailable inventory.
32. As a guest, I want duplicate payment verification to confirm at most one Reservation, so that retries cannot produce duplicate contracts.
33. As a guest, I want a durable Booking Contract snapshot and confirmation after authoritative payment verification, so that chat or a callback alone cannot create a reservation.

### Guests — arrival, stay, changes, and conduct

34. As a guest, I want the contractual arrival boundary clearly stated as 2:00 PM–10:00 PM WAT, so that arrival obligations and support coverage are predictable.
35. As a guest, I want live Human Incident Support during the Contractual Check-In Window, so that failed access is not handled solely by automation.
36. As a guest, I want Verified Access determined from an evidence hierarchy rather than an Operator assertion, so that revenue release and remedies rest on credible facts.
37. As a guest, I want check-in guidance and access information delivered through authorized, secure channels, so that I can enter without exposing the Unit.
38. As a guest, I want the standard Contractual Checkout to be 11:00 AM WAT, so that my obligations are consistent across Units.
39. As a guest, I want to request Late Checkout only in fixed increments up to 2:00 PM, so that any change is operationally and contractually precise.
40. As a guest, I want Late Checkout prohibited when any same-day incoming Reservation exists, so that turnover safety is not compressed.
41. As a guest, I want every material date, price, occupant, or checkout change to use a versioned Booking Amendment, so that informal messages cannot alter my contract.
42. As a guest, I want a revised quote and explicit acceptance before a charged amendment takes effect, so that no informal fee is imposed.
43. As a guest, I want my original Booking Contract to remain valid until an amendment completes atomically, so that a failed change does not leave me without clear terms.
44. As a guest, I want House Rules to prohibit parties, unsafe conduct, undisclosed commercial use, excess occupancy, indoor smoking, and unreasonable noise, so that expectations are consistent.
45. As a guest, I want visitor, pet, child, quiet-hour, and occupant rules disclosed per the standardized launch policy, so that an Operator cannot invent rules during my stay.
46. As a guest, I want rule enforcement to be proportionate, evidence-backed, and human-reviewed where consequential, so that an Operator cannot levy arbitrary cash fines.
47. As a guest, I want an overstay incident handled through standardized platform rules, so that informal payments or WhatsApp extensions cannot replace evidence and policy.

### Guests — cancellation, failures, remedies, and deposits

48. As a guest, I want each Unit to use Flexible, Standard, or Firm Cancellation Policy rules captured when my request begins, so that refunds are deterministic.
49. As a guest, I want cancellation percentages applied only to the Cancellation Base, so that deposits and unprovided services are not wrongly retained.
50. As a guest, I want operator failure, illegality, material unsafety, and non-excludable rights to override ordinary cancellation rules, so that policy cannot excuse failed fulfilment.
51. As a guest, I want No-Show status confirmed by a human only after required contact attempts and the next-day deadline, so that a delayed arrival is not misclassified automatically.
52. As a guest, I want Mid-Stay Failures classified by safety, essential amenity, material advertised amenity, or minor impact, so that remedies match severity and duration.
53. As a guest, I want cure windows and per-night refunds calculated from the affected contracted line item, so that a material failure produces a transparent remedy.
54. As a guest, I want to choose between a Comparable Replacement and a full refund when qualifying fulfilment failure occurs, so that relocation is not forced on me.
55. As a guest, I want relocation to remain a best-available remedy subject to approval limits, so that support can help without promising impossible inventory.
56. As a guest, I want the Guest Protection Fund to back approved remedies when ordinary recovery is unavailable, so that platform protection is credible.
57. As a guest, I want a Refund Fallback guaranteed when relocation cannot be completed, so that I am not trapped in an unresolved incident.
58. As a guest, I want a Refundable Security Deposit quoted separately and capped by Unit size and accommodation value, so that the hold is proportionate.
59. As a guest, I want a successful deposit claim notice with evidence and a 48-hour Claim Response Window, so that I can answer the actual allegation.
60. As a guest, I want the Operator to bear the burden of proving loss on the Balance of Evidence, so that the deposit is not presumed forfeited.
61. As a guest, I want one internal Claim Appeal after a notified decision, so that material factual or policy error can be reviewed independently.
62. As a guest, I want claim awards reserved until Internal Finality and unresolved notification failures closed on published deadlines, so that money is not released prematurely.

### Operators and supply

63. As an Operator, I want to contract as the Accommodation Provider while the platform facilitates the booking, so that legal responsibility is explicit.
64. As an Operator, I want onboarding limited to verified registered businesses or otherwise approved registered contracting entities, so that launch supply has accountable counterparties.
65. As an Operator, I want to prove current Management Authority for every Unit through checkout, so that I cannot contract beyond my rights.
66. As an Operator, I want each Unit physically inspected before publication and reinspected after expiry or Material Unit Change, so that Verification Claims remain current.
67. As an Operator, I want a scheduled reinspection to confer no provisional eligibility, so that pending evidence is not mistaken for passed evidence.
68. As an Operator, I want launch inspection, licensing, insurance, settlement-account, and responsible-person requirements stated clearly, so that I can prepare a complete onboarding package.
69. As an Operator, I want non-exclusive inventory permitted, so that I can sell elsewhere while keeping the platform Availability Calendar authoritative through immediate Operator Blocks.
70. As an Operator, I want a 45-minute Operator Hold with one eligible 15-minute extension, so that I can manage a real prospect without indefinitely suppressing inventory.
71. As an Operator, I want minimum Active Hours of 8:00 AM–8:00 PM WAT daily, so that response expectations are predictable.
72. As an Operator, I want structured Booking Request disclosures and confirm-or-decline actions, so that I can decide without relying on free-form chat.
73. As an Operator, I want Same-Day Turnover to be an earned Unit capability, so that reliable Units are distinguished from unproven ones.
74. As an Operator, I want clear Turnover Plan, Turnover Run, Readiness Deadline, and Ready for Arrival requirements, so that same-day operations are measurable.
75. As an Operator, I want missed readiness deadlines to trigger a documented workflow and graduated restoration, so that one defect is distinguished from repeated or egregious failure.
76. As an Operator, I want enforcement based on published severity and recurrence thresholds with reasons, evidence, remediation, and one appeal, so that consequences are predictable and reviewable.
77. As an Operator, I want platform and provider faults excluded from my reliability record, so that I am not penalized for failures outside my control.
78. As an Operator, I want ordinary commission calculated only on Commissionable Operator Revenue, so that deposits, damage awards, taxes, and pass-through money are excluded.
79. As an Operator, I want founding and Preferred commission terms captured prospectively, so that rate changes cannot rewrite existing bookings.
80. As an Operator, I want a controlled catalogue for optional services and no off-platform payment demand, so that additions remain disclosed and auditable.
81. As an Operator, I want a clear Revenue Release and Payout Plan with visible reserve, liability, and settlement projections, so that I can forecast cash flow.
82. As an Operator, I want Operator Trust Tier progression based on completed bookings and reliability, so that strong performance earns improved payout terms.

### Operations, support, finance, risk, and inspection

83. As an inspector, I want a standardized Unit checklist covering possession, sanitation, structure, safety, utilities, locks, privacy, cameras, listing accuracy, and current media, so that inspection evidence is consistent.
84. As an operations agent, I want expiry notifications and automatic eligibility removal for inspection, authority, licensing, or insurance lapse, so that pending renewal never grants supply rights.
85. As a support responder, I want a complete Human Handoff packet with current projections, versions, deadlines, committed actions, proposals, evidence references, and policy context, so that I can take over safely.
86. As a support responder, I want human ownership to suspend autonomous user messages and state-changing tools, so that automation does not compete with me.
87. As a support responder, I want to return a matter to automation only through explicit handback and a fresh Interaction Projection, so that a stale run is never resumed silently.
88. As a risk reviewer, I want predictable Human Risk Review before request disclosure and before the Latest Disclosure Cutoff, so that review cannot consume an unsafe portion of the booking window.
89. As a finance operator, I want balanced ledgers for guest funds, Operator Net, commission, deposits, reserves, claims, refunds, relocation, and Guest Protection Fund movements, so that every amount is attributable.
90. As a finance operator, I want one Revenue Release per launch Reservation and risk-equivalent Payout Plans, so that settlement is auditable without fragmenting stay revenue.
91. As a finance operator, I want Rolling Reserve and protection-fund targets driven by published provisional rules, so that loss exposure is controlled pending validation.
92. As an authorized reviewer, I want final safety, relocation, deposit, enforcement, payout, and adverse-risk decisions reserved for humans, so that AI cannot exercise unsupported authority.
93. As an internal administrator, I want deterministic recovery and reconciliation interfaces, so that outages, late callbacks, and exceptional states can be repaired without database manipulation.

### Interaction and channel experience

94. As a web user, I want conversational assistance and approved Generative Surfaces to coexist with conventional pages, so that I can choose the clearest route.
95. As a web user, I want stale, expired, invalid, or unsupported surfaces to lose action authority and fall back safely, so that obsolete UI cannot change current state.
96. As a web user, I want reconnects to restore the current thread and surfaces from authoritative projections, so that a poor network does not create a new transaction.
97. As a web user, I want material actions to show exact effects and use short-lived confirmation authority, so that consent is specific and cannot be replayed.
98. As a user with accessibility needs, I want WCAG 2.2 AA behaviour, keyboard access, screen-reader support, reduced motion, stable focus, and understandable deadlines, so that agent-driven UI remains usable.
99. As a Nigerian mobile user, I want English (Nigeria), NGN, WAT, a 320-pixel layout, critical text before media, and explicit offline state, so that the service works under realistic conditions.
100. As a WhatsApp user, I want supported discovery, status, reminders, structured actions, triage, and Human Handoff, so that I can use a familiar channel without weakening contractual controls.
101. As an Instagram prospect, I want a concise discovery response and secure web link, so that I can continue safely without treating Instagram as a booking channel.
102. As a user switching channels, I want lawful context preserved but sensitive information reauthorized, so that I do not repeat everything or expose protected data.
103. As a user, I want General Support from 8:00 AM–8:00 PM daily and the stated check-in and active-stay emergency paths, so that service expectations are explicit.
104. As a user, I want to stop an agent run without being told that already committed actions were undone, so that the interface reports reality accurately.

### Platform and future Domain Packs

105. As a platform developer, I want Domain Packs to register their own vocabulary, tools, workflows, policies, and UI catalogues, so that future domains reuse infrastructure without inheriting shortlet semantics.
106. As a platform developer, I want Channel Adapters to translate Interaction Artifacts without owning transaction state, so that channel changes cannot fork business behaviour.
107. As a platform developer, I want provider integrations behind certified adapters, so that PSP, identity, maps, calendar, messaging, and notification vendors can change without rewriting domain logic.
108. As a platform developer, I want the selected web presentation runtime isolated behind the Web Agent Adapter, so that replacing it does not change application commands, domain models, canonical Interaction Artifacts, or supported presentation semantics.
109. As a platform developer, I want every consequential interaction to use a Platform Command Envelope, so that identity, authorization, idempotency, concurrency, confirmation, and audit are uniform.
110. As a platform developer, I want every material agent action to have Deterministic Parity, so that the platform remains operable during agent or framework failure.

## Implementation Decisions

- Build a shared Concierge Platform plus a separate Shortlet Booking Domain Pack; the internal SDK remains private until a second real domain validates its abstractions.
- Keep authoritative transaction state in application services, domain aggregates, databases, ledgers, and policy engines. Conversation state, Interaction Projections, A2UI presentation/component state, the Web Agent Adapter/runtime, and channel adapters only project or request state.
- Launch only in Lagos and Abuja with inspected entire-place inventory, registered Operators, current Management Authority, required regulatory evidence, and eligible insurance.
- Operators are the contracting Accommodation Providers. The platform facilitates discovery, contracting, collection, support, protection, settlement, and enforcement without becoming the accommodation supplier.
- Use Request to Book exclusively at launch. Inventory is blocked for the disclosed request and subsequent payment lifecycle under the accepted Operator Hold, request-delivery, response, and payment deadlines.
- Use one-to-fourteen-night stays, a rolling 90-day Booking Horizon, same-day booking without shortcuts, and the accepted arrival, checkout, Late Checkout, Same-Day Turnover, readiness, and reinspection rules.
- Maintain an authoritative Availability Calendar with immediate Operator Blocks for all off-platform commitments. Non-exclusive supply is permitted only while this obligation is met.
- Require Primary Guest identity verification, occupancy, occupant disclosure, and accepted payer-attribution controls before contracting.
- Present mandatory All-In Stay Totals throughout discovery and contracting. Capture immutable quote, disclosure, tax, policy, and contract versions at the applicable lifecycle points.
- Collect the full booking amount for launch Reservations. Use fresh PSP-hosted cards, capability-gated USSD, and booking-specific expiring bank transfers; prohibit saved cards and direct or cash payment.
- Verify payment authoritatively before confirmation. Enforce one Live Payment Attempt, the 20-minute window plus ten-minute processing grace, inventory release at the deadline, and automatic refund of later successful payment.
- Maintain double-entry or equivalently balanced financial records for booking consideration, commission, Operator Net, Revenue Release, reserves, deposits, claims, refunds, relocation, liabilities, and Guest Protection Fund movements.
- Apply the standardized cancellation catalogue, No-Show controls, Booking Amendment workflow, guest-conduct rules, Mid-Stay Failure remedy matrix, and per-night remedy calculations.
- Support Refundable Security Deposits under one evidence-led claim model with successful notification, guest response, internal decision, one appeal, Internal Finality, and published closure deadlines.
- Fund ordinary guest protection through the platform Guest Protection Fund while preserving Operator liability and recovery. Give the guest the qualifying relocation-or-refund choice and guarantee Refund Fallback.
- Use the accepted provisional launch commission, deposit caps, insurance limits, reserve rules, fund targets, relocation approval tiers, and payout Trust Tiers until their validation gates close.
- Provide human authority for consequential safety, access, identity, payment inconsistency, risk, relocation, deposit, refund, payout, enforcement, discrimination, and fraud decisions.
- Enforce published Operator coaching, restriction, suspension, restoration, revocation, appeal, and termination rules using evidence, severity, recurrence, causation, and human review.
- Generate a canonical Interaction Artifact from authoritative projections and translate it into channel-appropriate presentations. Preserve semantic and contractual parity even when visual parity is impossible.
- Web supports all launch workflows. WhatsApp supports only its approved capability matrix and redirects complex or sensitive work to authenticated web. Instagram is discovery and referral only.
- Use the platform-owned, versioned Interaction Stream contract for registered events, ordering, replay, validation, failure behaviour, and controlled upgrades; it remains framework-neutral and is not a renderer transport profile.
- Treat the Interaction Projection as derived state with server-owned facts, client-local ephemeral state, and user draft input accepted only through Platform Actions. Server-owned facts remain authoritative only through application state; client-local state is never authoritative, and drafts become consequential only through trusted Platform Actions and application commands.
- Distinguish principal, tenant, device, browser session, tab, Interaction Thread, Agent Run, message, Generative Surface, Platform Action, command, and domain aggregate identities. Permit one mutating run per thread.
- Route consequential interactions through a Platform Command Envelope with independent authentication, authorization, validation, policy evaluation, idempotency, expected-version checking, confirmation, and audit.
- Use A2UI v0.9.1 Basic Catalog first with deterministic approved component usage. Unsupported catalogue or version behaviour fails safely; custom shortlet catalogues remain deferred until justified and certified. Validate every message and prohibit dynamic schema, executable UI, unsafe rich content, and arbitrary client tools.
- Give Generative Surfaces immutable catalogue selection, revisions, domain correlations, explicit lifecycle status, stale-action rejection, safe text fallback, and conventional-route fallback.
- Isolate the current Weaver web presentation runtime inside the replaceable Web Agent Adapter. Keep framework types outside authoritative packages, test deterministic presentation behaviour, and ensure replacement does not change commands or domain semantics.
- Preserve conventional deterministic routes for every state-changing, recovery-critical, support, and administrative workflow. Agent failure cannot remove the platform's ability to search, contract, collect payment, manage stays, resolve incidents, or support users.
- Target WCAG 2.2 AA, English (Nigeria), NGN stored in kobo, Africa/Lagos time, unambiguous contractual dates, mobile layouts, reduced motion, restrained live-region updates, and degraded-network recovery.
- Apply data minimization, tenant isolation, redaction, strict rendering, secure sessions, CSRF and content controls, safe uploads, protected location/access release, and separate restricted identity storage.
- Use explicit Human Handoff modes. Stop halts future agent work but does not undo committed actions; human ownership suspends automation; resumption requires deliberate handback and a fresh projection.
- Make interaction streams ordered, replayable, at least once, deduplicated, traceable, compactable, rate-limited, and recoverable. Treat numeric stream limits, timeouts, SLOs, and retention periods as provisional engineering values pending validation.

## Testing Decisions

- Tests prioritize stable authoritative boundaries and externally visible behaviour rather than framework/runtime-specific component trees, hooks, wiring, controller wiring, or internal call structure.
- The application-command seam carries the largest share of behavioural coverage. Tests invoke real command handlers, policy engines, repositories, transaction boundaries, projections, ledgers, events, outbox behaviour, and audit recording where practical.
- Application-command tests cover valid and invalid transitions, stale versions, authorization failures, duplicate commands, exact deadline boundaries, captured policy versions, concurrent attempts, monetary invariants, and resulting authoritative state.
- The Deterministic Parity seam runs a canonical actor, intent, domain state, disclosure, and input fixture through every permitted A2UI, conventional web, WhatsApp, and support mechanism. It compares command meaning, validation, authorization, policy, confirmation, idempotency, audit classification, and resulting projection rather than raw transport shapes.
- Platform interaction stream/replay tests cover stream version validation, registered events, ordering, duplicates and conflicts, gaps, reconnect, compaction, limits, and telemetry. A2UI/Weaver presentation tests cover deterministic Interaction Artifact to A2UI projection, Basic Catalog compatibility, DOM/render behaviour, server/client events, stale or expired authority integration, safe fallback, and accessibility behaviour.
- Presentation assertions compare normalized visible facts, available and disabled actions, deadlines, surface state, fallback content, produced commands, and accessibility semantics rather than framework component trees.
- The Channel Adapter seam begins with a canonical Interaction Artifact and verifies that every supported channel preserves exact money, currency, deadlines, consequences, disclosures, references, policy versions, consent meaning, sensitivity, and capability restrictions.
- Maintain the channel-capability matrix as shared test data. Fail a projection that drops required meaning, changes money or time, exposes protected data, offers unsupported authority, or treats acknowledgement as consent.
- Automated provider-contract tests use local fixtures, recorded signed messages, sandboxes, fake clocks, delayed and out-of-order callbacks, duplicates, unknown states, retries, idempotency, timeouts, redaction, circuit breaking, and recovery.
- Provider certification is a separate launch gate using production-equivalent evidence for reference expiry, payment timing, late success, refunds, settlements, identity ambiguity, message delivery, calendar conflicts, and any other claimed provider capability.
- Keep the end-to-end suite small and journey-oriented. It covers representative guest booking, same-day booking, payment failure and retry, late payment, failed access and relocation, Operator cancellation, Booking Amendment, deposit claim and appeal, Operator request and turnover operations, and support takeover and recovery.
- End-to-end journeys include failure and reconciliation paths; a happy-path-only system is not launch-ready.
- Use focused unit, property-based, and state-machine tests for cancellation and refund calculations, deposit and reserve calculations, time windows, availability overlap, aggregate transitions, JSON Patch sequencing, catalogue and command validation, authorization, redaction, signatures, idempotency keys, money and rounding, timezone conversion, and risk rules.
- Use real database transactions for concurrency-critical tests: competing Booking Requests, payment versus inventory expiry, Operator Block versus disclosure, duplicate webhook processing, two-tab confirmation, expected-version conflict, ledger balance, and outbox publication.
- Run adversarial security cases across all seams, including cross-tenant references, stale confirmation tokens, prompt/tool injection, malicious A2UI, unauthorized address disclosure, replay, CSRF, session revocation, log-redaction failure, malicious uploads, and forged provider callbacks.
- Do not add low-level tests merely to prove that a controller calls a service or that a component invokes an adapter.
- A feature is complete only when authoritative command behaviour, conventional route, failure recovery, audit trail, supported channel projections, persistence invariants, and security obligations pass.

## Out of Scope

- Instant Book at launch
- Shared rooms, private rooms, hotels operated outside the approved entire-place model, or stays longer than fourteen nights
- Expansion beyond Lagos and Abuja
- Unregistered individuals as contracting Operators
- Third-party bookings outside the accepted payer-attribution exception
- Saved-card or reusable-token checkout
- Guaranteed USSD before Payment Capability Certification
- Cash, direct-transfer, or off-platform payment and fee collection
- Arbitrary Operator-defined cancellation, deposit, late-checkout, conduct, remedy, or penalty rules
- Automated final decisions on safety, identity, risk, fraud, relocation spending, disputes, deposits, refunds, payouts, or enforcement
- Voice agents, autonomous outbound calling, and unrestricted proactive marketing
- Instagram booking completion
- Dynamic-schema A2UI, arbitrary HTML or JavaScript, generated executable client code, or unrestricted browser automation
- Making conversational state, Interaction Projections, A2UI component state, a Web Agent or Channel Adapter, or an LLM the system of record
- Public release of the internal Concierge Platform SDK before a second Domain Pack validates its abstractions
- Full implementation of Marketplace Commerce, appointments, or other future Domain Packs
- Full localization beyond English (Nigeria), although content must be externalizable
- Treating provisional commercial, tax, insurance, fund, payout, reliability, retention, or transport thresholds as validated launch facts

## Further Notes

- Accepted, current decisions from ADR-0003 through ADR-0081 are normative for this PRD. Commerce-only, deprecated, and superseded records remain contextual or historical rather than shortlet launch requirements.
- The Shortlet Launch Validation Gates must close PSP selection, channel certification, identity/privacy readiness, Nigerian legal and tax review, insurance placement, Operator validation, unit economics, and operational simulations.
- The Interaction Architecture Validation Gates must close the A2UI/Weaver boundary, platform interaction stream reliability, surface lifecycle/authority, identity/concurrency, security/privacy, Human Handoff, cross-channel parity, reliability, and accessibility.
- Provisional values include commission and founding duration, insurance limits, deposit caps, Guest Protection Fund parameters, relocation authority, payout Trust Tier thresholds, tax and withholding treatment, interaction retention, transport limits, timeouts, and SLOs.
- Failure of a validation gate reopens only the affected policy, amount, capability, or interaction architecture decision; it does not implicitly reopen the complete product model.
- Regulatory and provider assumptions require current primary-source and specialist review immediately before launch.
