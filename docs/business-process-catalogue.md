# Business Process Catalogue
**Project:** Chat Marketplace / Concierge Platform  
**Version:** 0.1, proposal  
**Date:** 10 November 2026  
**Status:** Strategy and product design only. Not an accepted ADR or implementation authorization.  
**Scope:** Shortlet baseline plus possible local-directory domain packs.

## 1. Purpose and business thesis

The business researches, verifies, and curates local providers. Its software then helps people complete useful actions with those providers.

A directory listing starts a process. It does not prove that the requested service happened.

The customer outcome can be a confirmed stay, event admission, restaurant table, food order, appointment, quotation, or accepted enquiry. The next step is not always payment.

**Core journey:** Discover -> Check fit and terms -> Request or commit -> Provider response -> Complete -> Resolve exceptions.

The goal is to reduce uncertainty, repeated contact, lost context, and manual follow-up. It is not to own every provider's operations.

### Principles

1. **Truth before conversion.** Show a confirmed outcome only after its authoritative source confirms it.
2. **Provider control.** A provider must authorize every commitment that binds its capacity, inventory, or work.
3. **A customer controls material actions.** Show the exact effect before a booking, order, payment, or cancellation.
4. **One platform, distinct domains.** Share interaction infrastructure, not a universal booking or order contract.
5. **Curated supply first.** Start with direct provider relationships and verified records.
6. **Assisted before integrated.** Use request-and-response flows before building real-time inventory integrations.
7. **Deterministic recovery.** Every critical action must work without the model.
8. **No invented availability.** Unknown availability produces an enquiry or a request, never a false confirmation.
9. **Measured expansion.** Introduce another process after evidence shows that customers and providers value its completion.
10. **Honest scope.** Future directory workflows do not change the stays-only public launch or parked commerce decision.

## 2. Repository baseline and governing decisions

This catalogue is a **proposal for future domains**. Existing Shortlet rules take priority over illustrative process patterns.

| Existing decision | Constraint on this catalogue |
| --- | --- |
| [ADR 0003](adr/0003-build-an-extensible-concierge-platform.md) | Shortlet is the first reference domain. The SDK remains internal until real second-domain evidence exists. |
| [ADR 0004](adr/0004-web-and-backend-own-authoritative-state.md) | Backend services own transaction state; channels display it. |
| [ADR 0005](adr/0005-launch-exclusively-with-request-to-book.md) | Stays require operator acceptance, then verified payment, before a reservation exists. |
| [ADR 0015](adr/0015-use-all-in-pricing-throughout-the-booking-funnel.md), [ADR 0016](adr/0016-standardize-refundable-security-deposits.md) | Stay totals and refundable security deposits have distinct meanings. |
| [ADR 0041](adr/0041-block-inventory-for-thirty-minutes-per-disclosed-request.md), [ADR 0042](adr/0042-require-daily-operator-response-coverage.md) | Shortlet request holds and response coverage have domain-specific rules. Do not generalize them to events or restaurants. |
| [ADR 0072](adr/0072-route-consequential-actions-through-platform-commands.md) | Consequential actions use authenticated, authorized, auditable commands with idempotency and concurrency checks. |
| [ADR 0073](adr/0073-govern-domain-specific-a2ui-catalogues.md), [ADR 0074](adr/0074-give-generative-surfaces-a-fail-closed-lifecycle.md) | Only approved UI catalogues may render actions. Stale or expired surfaces lose authority. |
| [ADR 0075](adr/0075-secure-and-minimize-agent-interaction-data.md), [ADR 0080](adr/0080-retain-deterministic-parity-for-critical-workflows.md) | Minimize private data. Provide deterministic paths for all critical actions. |
| [ADR 0092](adr/0092-offer-extended-stays.md) | Short Stays and Extended Stays have different contractual and billing rules. |
| [ADR 0099](adr/0099-define-the-domain-pack-interface-and-module-boundaries.md) | Each Domain Pack owns its model and ledger. Packs do not import each other. No universal transaction model. |
| [ADR 0101](adr/0101-multi-domain-cloudflare-hosting-and-platform-accounts.md) | Shared accounts, conversations, and tasks belong to the platform. Domain transactions remain isolated. |
| [ADR 0104](adr/0104-launch-stays-first-keep-commerce-off-in-public-deployments.md) | Public launch remains stays-only. Physical-goods Commerce is parked and off by default. |
| [ADR 0106](adr/0106-enforce-concierge-agent-controls.md) | Packs restrict tools, facts, scopes, and actions. Model replies cannot invent business facts or permissions. |
| [ADR 0107](adr/0107-present-each-domain-pack-as-an-agent-mode.md) | One concierge presents multiple Agent Modes. Cross-lane booking facts do not pass automatically. Switching needs approved controls. |

Also see [Context Map](../CONTEXT-MAP.md), [Concierge Platform language](../packages/platform-core/CONTEXT.md), and [Shortlet Booking language](../domains/shortlet/CONTEXT.md).

**Design boundary:** A reservation, RSVP, ticket, order, quote, and booking request are different agreements. Similar screens do not make their legal or operational state identical.

## 3. Provider relationship and directory lifecycle

The curated directory is a capability with its own lifecycle. It can publish a useful page without accepting transactions.

**Actors:** Researcher/editor, provider representative, reviewer, visitor, support operator.

**Directory record lifecycle:** candidate -> researched -> provider_contacted -> verified_for_scope -> published -> review_due -> updated / withdrawn / expired.

**Minimum record:** provider identity; category; location and service area; contact or approved action channel; provenance; last verified time; next review time; claims and confidence; published terms; ownership of supplied content; correction method.

**Evidence is claim-specific.** Checking a restaurant's address does not verify its menu, table availability, prices, or delivery coverage.

**Supply onboarding:**
1. Select a category and neighborhood.
2. Research a candidate and record sources.
3. Contact an authorized provider representative.
4. Verify only claims the evidence supports.
5. Agree on which customer requests the provider will receive and how.
6. Publish the listing with a correct first action.
7. Track response reliability and freshness.
8. Correct, pause, or remove stale and misleading claims.

**Provider participation levels:**

| Level | Provider capability | Customer-facing promise |
| --- | --- | --- |
| D0: Directory | Curated listing with trusted external contact or site | Explore details and visit provider's own service |
| D1: Assisted request | Receives structured enquiries by an agreed channel | Request sent; answer pending |
| D2: Managed response | Accepts or declines inside provider dashboard or secure action link | Confirmation after an authorized reply |
| D3: Integrated | Existing provider system supplies authoritative capacity and status | Direct booking only where integration and reconciliation are verified |

A provider may move between these levels. A directory must not advertise D3 behavior while the provider only supports D0 or D1.

## 4. Reusable process families

These are conceptual patterns for product design. They are **not** one shared state machine or a universal domain aggregate.

| Pattern | Typical sequence | Possible domains |
| --- | --- | --- |
| P1 Information and referral | Explore -> Inspect -> Open verified destination -> External result | Places, schools, community groups |
| P2 Enquiry and response | Prepare -> Submit -> Provider replies -> Follow up / close | Schools, services, community membership |
| P3 Request and approval | Select -> Request -> Pending -> Accept/decline -> Confirmation | Restaurant tables, appointment requests |
| P4 Capacity and admission | Select slot/ticket -> Validate capacity -> Reserve or purchase -> Issue proof -> Admit | Events, coworking |
| P5 Quote and acceptance | Describe scope -> Quote -> Review -> Accept -> Schedule -> Fulfil | Local services, relocation |
| P6 Order and fulfillment | Review items -> Place order -> Provider accepts -> Prepare -> Deliver/pick up -> Resolve | Restaurant food orders |
| P7 Contract and verified payment | Quote -> Request -> Provider accepts -> Offer -> Customer accepts/pays -> Confirm | Shortlet Booking |

Platform-wide capabilities may include accounts, messages, notifications, audit, secure provider responses, and payment-provider integration. Each domain still defines its own commands, deadlines, rules, transaction identity, and ledger.

## 5. Business process register

All items marked **Proposed** require a domain decision and provider validation before implementation.

| ID | Domain process | Customer outcome | Initial approach | Priority |
| --- | --- | --- | --- | --- |
| BPC-00 | Directory intake and maintenance | Trustworthy listing, clear next action | Editorial workflow | Foundation |
| BPC-01 | Furnished stay request to book | Confirmed accommodation contract | Existing Shortlet rules | Existing baseline |
| BPC-02 | Event RSVP | Organizer-accepted attendance request | D1/D2 | High candidate |
| BPC-03 | Paid event ticket | Valid ticket or external purchase | D0 link-out first | High candidate, later capability |
| BPC-04 | Restaurant table reservation | Confirmed table, date, time, party | D1/D2 | High candidate |
| BPC-05 | Restaurant food order | Restaurant-accepted order and handover | External/provider-managed first | Later |
| BPC-06 | Local service quotation | Current, scoped offer from a provider | D1/D2 | Medium |
| BPC-07 | Appointment scheduling | Accepted appointment and instructions | D1/D2 | Medium |
| BPC-08 | Community membership / activity RSVP | Accepted join or participation request | D0/D1 | Medium |
| BPC-09 | School enquiry / school visit | Responded enquiry or confirmed visit | D0/D1 | Later |
| BPC-10 | Coworking day or desk booking | Confirmed access for defined period | D1/D2 | Later |
| BPC-11 | Relocation coordination | Fulfilled set of independently confirmed tasks | Human-assisted orchestration | Later |

### BPC-01: Furnished stay request to book [Existing]

**Owner:** Shortlet Booking Domain Pack, not a shared reservation service.  
**Actors:** Guest; Operator; accommodation provider; platform payment and support services.  
**Preconditions:** Unit is eligible for discovery; authoritative dates and quote are valid; request satisfies applicable policies.

**Authoritative sequence:**
1. Guest searches and reviews a Stay Quote.
2. Guest prepares a Request Draft. A draft blocks nothing.
3. Guest submits a Booking Request within allowed conditions.
4. The request reaches the Operator and obtains the applicable exclusive block.
5. Operator confirms availability or declines within the applicable deadline.
6. If confirmed, the guest receives a Conditional Booking Offer.
7. Guest reviews and accepts the offer, then pays through an approved payment path.
8. Verified payment and committed domain state create a Reservation.
9. Check-in, verified access, protection, cancellation, deposit, and support policies continue under Shortlet rules.

**Failure paths:** invalid or stale quote; unavailable unit; failed operator delivery; rejection; expired request; superseded offer; payment not verified; late payment; failed access; complaint and refund.

**Customer language:** 'Request sent' is not 'Booking confirmed'. 'Operator accepted' is not 'Reservation confirmed'.  
**Metrics:** eligible search rate; request delivery success; operator acceptance; time to response; payment completion; verified check-in; fulfilment incidents; contribution margin.

Do not duplicate Shortlet's existing states, timelines, or policy values inside a shared catalogue.

### BPC-02: Event RSVP [Proposed]

**Actors:** Attendee; organizer; platform.  
**Input:** event and occurrence id, date/time and timezone, attendee count, eligibility rules, terms, necessary contact details.  
**Sequence:** discover event -> inspect verified schedule -> request RSVP -> notify organizer -> organizer accepts/declines -> send confirmation and check-in instructions -> check attendance if supported.

**Proposed domain states:** draft, submitted, awaiting_organizer, accepted, declined, cancelled, expired, attended, no_show. These labels are design placeholders, not approved code constants.

**Authority:** Only the organizer or verified integrated source confirms attendance. A request receipt must never look like an admission ticket.

**Failure/recovery:** event cancelled; event moved; capacity exhausted; organizer silent; duplicate request; attendee changes party size. Notify the attendee and offer a new choice. Never substitute a different event silently.

**Pilot:** Organizer handles attendee list and admission. Platform transmits structured RSVP requests and shows provider response. No ticket generation or payment required.

**Measures:** organizer response rate; confirmed RSVPs; attendance verification; time saved per RSVP; complaints.

### BPC-03: Paid event ticket [Proposed]

**Actors:** Buyer; organizer or authorized ticket seller; payment service; gate staff where applicable.  
**Input:** event occurrence; ticket class; quantity; capacity; total charges; refund/cancellation policy; organizer of record.

**Stage A, safest first version:** curate the event, disclose current source and last verification, send the buyer to an organizer-approved ticket page. Show 'Continue to ticket provider'. Do not claim purchase, reservation, or admission from click activity.

**Stage B, only with proven supply:** request authoritative allotment -> validate class and price -> short-lived hold if supported -> explicit checkout approval -> payment verification -> issuer generates a unique ticket -> deliver ticket -> check-in/reconciliation.

**Authority:** The ticket issuer controls tickets and their validity. The platform may represent an issued ticket only with trusted confirmation.

**Failure/recovery:** sold-out inventory, simultaneous sales, late payment, event postponement, cancellation, duplicate ticket, transfer restrictions, failed gate scan, refund dispute. Define who owes the refund before the platform becomes merchant of record.

**Non-goal:** Building venue entry systems before a ticket partner can actually use them.  
**Measures:** verified ticket conversions; successful admissions; cancellations; refund time; provider fees; support cost.

### BPC-04: Restaurant table reservation [Proposed]

**Actors:** Diner; restaurant representative; platform.  
**Input:** restaurant, date, local time, party size, seating preference if supported, accessibility needs where relevant, contact and cancellation rules.

**Default sequence:** browse -> request table -> restaurant checks its real capacity -> accepts or proposes an alternative -> diner confirms if terms changed -> restaurant sends final confirmation -> diner attends.

**Proposed states:** draft, requested, awaiting_restaurant, alternative_proposed, confirmed, declined, cancelled, completed, no_show.

**Authority:** A directory showing opening hours is not evidence of a free table. Only authorized restaurant acceptance or a validated live inventory connection confirms a reservation.

**Important exceptions:** no response; closing time; changed party size; table time conflict; inaccessible seating; deposit required; cancellation or no-show charges. A changed time requires the diner to agree.

**Pilot:** D1/D2 reservation requests to a few participating restaurants. Record response times and no-shows. Do not promise 'instant book' without a verified capacity feed.

**Measures:** confirmed reservations, response time, attendance, restaurant handling time, guest disputes.

### BPC-05: Restaurant order and fulfillment [Proposed, later]

**Actors:** Customer; restaurant; payment provider if used; courier only when explicitly contracted.  
**Input:** source-verified menu; options; item quantity; price; taxes/fees; address or pickup time; availability; fulfillment terms; special instructions.

**Sequence:** discover menu -> assemble order -> restaurant revalidates price/stock -> customer approves total -> restaurant accepts -> payment according to agreed terms -> preparation -> pickup / courier handover -> delivery proof or pickup completion -> issue resolution.

**Separate confirmations:** 'Order sent', 'Restaurant accepted', 'Preparing', 'Ready for pickup', 'Out for delivery', and 'Delivered' have different evidential requirements.

**Failure/recovery:** unavailable item; unsafe substitution; food allergy instruction not acknowledged; restaurant decline; late preparation; courier loss; missing item; duplicate charge; cancellation; refund. Never promise dispatch without a named accountable provider.

**Pilot:** Restaurant-managed pickup or external ordering link. Integrate delivery only after an existing delivery partner accepts responsibility. Do not operate a fleet.

**Measures:** accepted-order rate; handover success; fulfillment time; refunds; per-order margin after support and dispatch costs.

### BPC-06: Local service quotation [Proposed]

**Examples:** cleaning, repairs, moving help, photography, catering.  
**Actors:** Customer; service provider; platform.  
**Input:** service location, requested outcome, scope, schedule, measurements/photos where necessary, budget if voluntarily supplied.

**Sequence:** submit a scoped enquiry -> eligible provider reviews -> provider issues a versioned quote -> customer compares scope, exclusions, price, validity and cancellation terms -> customer accepts or declines -> service scheduling begins.

**Authority:** A provider quote is not a completed service. No platform-generated price becomes binding without provider authorization.

**Failure/recovery:** insufficient scope; revised quote; expired quote; provider unavailable; site visit required; deposit dispute. Keep older quote versions for audit.

**Pilot:** Managed quote requests and secure provider reply links. Payment may remain external.

**Measures:** reply rate; time to quote; accepted quotes; repeat provider use; hours saved.

### BPC-07: Appointment scheduling [Proposed]

**Examples:** repairs, consultations, venue viewings, beauty services.  
**Actors:** Customer; provider; platform.  
**Sequence:** select service -> request time -> provider accepts/proposes time -> customer agrees -> confirm appointment -> send reminders -> mark attended/completed or cancelled.

**Authority:** Requested time is not confirmed time. A provider-controlled calendar must be checked before the platform can offer immediate booking.

**Failure/recovery:** double booking; late arrival; provider absence; reschedule; no-show; deposit. Keep changes as distinct accepted amendments.

**Pilot:** Assisted provider response, then managed schedule. Do not introduce a universal appointment model until two real domains need the same behavior.

### BPC-08: Community membership or activity RSVP [Proposed]

**Actors:** Interested person; community organizer; platform.  
**Sequence:** discover active group -> inspect requirements and next activity -> open official join link or send participation request -> organizer approves where needed -> member attends or joins existing channels.

**Authority:** The platform cannot promise membership in an independent community. Do not create public discussion rooms before organizers request them.

**Failure/recovery:** inactive community; private meeting details; consent restrictions; rejection; changed event; incorrect contact link.

**Pilot:** Directory and referral first. Offer RSVP only for groups with an agreed acceptance workflow.

**Measures:** successful introductions, organizer confirmations, repeat group activity, listing freshness.

### BPC-09: School enquiry and visit [Proposed]

**Actors:** Parent or prospective student; school representative; platform.  
**Sequence:** curated comparison -> inspect fee/curriculum and admission requirements with source dates -> submit consented enquiry -> school responds -> schedule visit -> complete visit -> return to school's own application process.

**Authority:** An enquiry, visit booking, or application referral never means admission. Do not describe a fee or seat as guaranteed without school confirmation.

**Data risk:** Student and child information requires higher protection. Avoid collecting sensitive student records for initial discovery.

**Pilot:** Information and school-directed enquiries only. No admissions workflow until explicit consent, school agreements, and legal review exist.

### BPC-10: Coworking access booking [Proposed]

**Actors:** Worker; space operator; platform.  
**Sequence:** discover -> select space and date/time -> check seat type and capacity -> request/confirm -> disclose any access terms and payment -> issue provider-approved entry instructions.

**Authority:** A listed desk capacity is not bookable inventory without a trusted current provider source.

**Failure/recovery:** network/power mismatch; no desk; access denial; schedule change; refund. Do not invent facility guarantees from marketing copy.

**Pilot:** Day-pass enquiry or provider checkout link, with validated information.

### BPC-11: Relocation task coordination [Proposed, later]

**Actors:** Relocating worker/family; employer when authorized; accommodation operator; independent service providers.  
**Sequence:** customer states needs -> creates a clear task list -> chooses providers -> authorizes each request separately -> receives distinct confirmations -> tracks delivery and exceptions.

**Boundary:** The platform may coordinate tasks. It must not pretend that a school visit, hotel booking, transport request, and service quote form one automatically guaranteed bundle.

**Pilot:** Human-supported coordination with explicit consent. No automatic cross-domain checkout or transfer of sensitive account facts.

**Measures:** number of completed tasks, time saved, repeat employer business, cost per coordinated case.

## 6. The minimum common interaction contract

This is an interface design checklist, not a new transaction aggregate.

Each proposed Domain Pack must define:

- **Customer intent:** what the person wants, required input, and unresolved questions.
- **Discovery:** eligibility, search scope, provenance, freshness, and display limits.
- **Provider authority:** what provider identity and authorization make a response binding.
- **Offer/terms:** price or absence of price, taxes, fees, conditions, expiry, and version.
- **Action:** exact customer command, authorization, idempotency key, expected version.
- **State:** domain-owned status vocabulary, deadlines, and transition rules.
- **Acknowledgement:** receipt of request versus provider acceptance versus completed outcome.
- **Notifications:** recipients, timing, safe content, retry, and delivery evidence.
- **Failure:** late, no reply, duplicate, changed terms, provider cancellation, partial fulfillment, fraud, and disputes.
- **Recovery:** edit, cancel, retry, alternative, refund where applicable, and human handoff.
- **Privacy:** minimal data, purpose, access rules, retention, deletion, and transfer limits.
- **Operations:** who monitors pending work; how providers respond; which exceptions support resolves.
- **Evidence:** how the system proves the request, acceptance, payment, completion, and remedy.
- **Measurements:** completed outcomes, provider work saved, quality, and contribution margin.

**Shared platform concerns:** accounts and sessions, conversation/task routing, surface validation, messaging adapters, approved payment ports, audit, idempotency enforcement, and human handoff.

**Pack-owned concerns:** capacity model, booking or order contract, specific policies, financial ledger, provider response rules, and fulfillment evidence.

### Cross-domain task rule

One user may request several services in a conversation. The platform tracks separate tasks. Each pack handles its own states and commands.

Under ADR 0107, guest booking facts do not cross task lanes automatically. Offer a clear 'Use these dates?' or 'Use 2 guests?' action, and transfer only after the guest approves.

A combined itinerary is a presentation, not one automatic binding transaction. Confirm each provider action independently.

## 7. Common customer states and language

Display truthful, provider-specific statuses. Examples:

| Situation | Good wording | Misleading wording |
| --- | --- | --- |
| An event RSVP was sent | 'Request sent. Waiting for the organizer.' | 'Your place is booked.' |
| Restaurant hasn't answered | 'Waiting for the restaurant to confirm.' | 'Table reserved.' |
| Customer opened external ticket site | 'Continue with the ticket provider.' | 'Ticket purchased.' |
| Service quote arrived | 'New quote available. Review before you accept.' | 'Service booked.' |
| Restaurant accepted order | 'Restaurant accepted your order.' | 'Your food is on its way.' |
| Shortlet operator accepted | 'Your offer is ready. Review and pay.' | 'Reservation confirmed.' |
| Shortlet payment verified and committed | 'Reservation confirmed.' | 'Request accepted.' |

Show timestamp, responsible provider, next action, and deadline where relevant. Never fabricate a deadline or imply a hold where the provider has granted none.

## 8. Provider-side experience

A provider should be able to complete a simple request without learning a large new system.

**Minimal provider inbox:** new requests; context and verified customer input; accept, decline, or propose change; request deadline; message history; final status; operational notes; export if needed.

**First pilot:** Use an authenticated provider page or secure expiring response link. An email, SMS, or WhatsApp alert may notify, but cannot by itself guarantee delivery or authorization.

**Later:** Integrate existing calendars, ticket inventory, ordering software, or enterprise tools only where provider volume supports the cost.

No provider should need to copy data manually between five screens merely to accept a request.

## 9. Exception and remedy matrix

| Exception | Default platform behavior | Authority |
| --- | --- | --- |
| Provider does not respond | Expire the request at its defined deadline; disclose no confirmation | Domain policy |
| Price or terms change | Withdraw old proposal; require fresh customer review | Provider + customer |
| Inventory or capacity conflicts | Reject stale action and refresh source; never oversell | Domain source of truth |
| Duplicate submit | Return previous result without repeating the effect | Command/idempotency gate |
| Payment succeeds but status fails to update | Reconcile against verified payment evidence; avoid duplicate charge | Platform payment + domain ledger |
| Third-party checkout is opened | Record handoff, not purchase success | External issuer |
| Provider cancels after confirmation | Show actual cancellation and remedy process | Domain contract + support |
| Provider system unavailable | Fall back to request or referral; do not claim real-time availability | Pack policy |
| Customer requests cancellation | Show exact terms and require applicable confirmation | Domain contract |
| Human takes over | Suspend agent-driven consequential steps until handback | Platform handoff |
| Cross-domain fact requested | Ask for explicit user approval before reuse | Platform/guest |
| Source becomes stale | Recheck, mark uncertain, or suspend the listing | Editorial owner |

The precise compensation, refund, retention, cancellation, and settlement policies for new domains are **open decisions**, not copied from Shortlet.

## 10. Unit economics and service quality

Operational automation is not inherently profitable. Calculate the entire cost of completing each process.

**Contribution per completed outcome** = attributable revenue - payment fees - provider fees/subsidies - delivery/partner expense - expected refunds and losses - variable support and verification cost.

Also track editorial sourcing and upkeep hours by category. Staff time belongs in the total economic model.

**North-star metric:** valid requests that reach the customer-defined completed outcome, with supporting evidence.

| Dimension | Measure |
| --- | --- |
| Discovery | Relevant results; freshness and source quality |
| Request | Submit success; valid request ratio |
| Provider response | Acceptance rate; median and 90th-percentile response time |
| Completion | Confirmed and actually fulfilled share |
| Failure | Expiry, no-shows, cancellation, duplicate charge, refund time |
| Efficiency | Minutes of provider work and platform support per request |
| Growth | Repeat providers; inbound referrals; cross-domain completed outcomes |
| Economics | Contribution per completion; editorial upkeep per active listing |

Segment results by city, provider, process, and participation level. Do not mix click-through, confirmed, and fulfilled events into one conversion rate.

## 11. Launch sequence and validation gates

**Current release posture:** Shortlet only in public deployment. Commerce stays disabled. Other domain proposals have no launch authorization.

**Phase A, research:** Interview 5-10 providers in each candidate category. Observe actual enquiry paths, tools, delays, price changes, and cancellation problems. Record how they determine a valid acceptance.

**Phase B, assisted pilot:** Select one category, one neighborhood cluster, and a small number of providers. Use curated listings and structured requests. Do not add booking/payment capability without provider agreement.

**Phase C, managed requests:** Provide a simple authenticated response workflow. Verify that pending, accepted, declined, expired, and revised outcomes remain correct across retries and restarts.

**Phase D, integration:** Consider real-time inventory or direct payment only after evidence of repeat demand, timely provider responses, and workable economics.

### Candidate decision: events or restaurant tables?

| Test | Events | Restaurant tables |
| --- | --- | --- |
| Inventory complexity | Ticket class, quantity, schedule, issuer | Date, time, party size, seating, operating hours |
| First pilot | Organizer-managed RSVP or external ticket link | Restaurant-managed request and confirmation |
| Complement to stays | Trip purpose and event-driven accommodation demand | Local dining around the stay |
| Standalone repeat usage | Depends on recurring local event supply | Depends on frequency of dining |
| Primary validation | Will organizers process and honor requests? | Will restaurants answer and honor reservations? |

**Recommendation:** Test event RSVP first because it avoids immediate payment and capacity integration. Test restaurant tables in parallel as a manual concierge service. Select the first real second Domain Pack only after comparing provider response and completion evidence.

### Go/no-go gates for a new domain

- At least one real provider can state what constitutes acceptance and completion.
- A customer can distinguish enquiry, pending, accepted, and completed states without help.
- The provider's response path has named ownership and dependable delivery.
- Stale inventory and changed terms cannot produce a false commitment.
- A deterministic customer route exists without the model.
- Consequential commands have authentication, idempotency, version, and audit controls.
- The required cancellation, payment, refund, privacy, and data-processing questions are resolved before handling money or sensitive records.
- Expected contribution covers ongoing verification, provider support, and failure handling.
- The domain has its own approved context glossary and ADR before implementation.

## 12. Decisions that remain open

This catalogue proposes workflows. It does not decide:

1. The first domain after Shortlet. ADR 0107 explicitly leaves that choice open.
2. Whether event RSVPs and paid tickets are one event pack or separate models within one pack.
3. Who is merchant of record for ticket purchases or restaurant food orders.
4. Whether platform charges customers, providers, both, or neither during pilots.
5. Provider authentication, authorization and response deadlines for new domains.
6. Cancellation, expiry, no-show, refund, payout, and complaint policies for new contracts.
7. Actual inventory feeds, external ticketing partners, courier roles, and restaurant software integrations.
8. Provider and customer data retention periods and applicable Nigerian compliance requirements.
9. Whether a public landing page expands beyond stays after actual domain launches.
10. Whether the directory itself lives as a shared discovery service or inside domain-specific packs. Do not decide this by creating a universal transaction model.

## 13. Next implementation planning artifacts

Prepare these only after choosing a candidate domain:

- A Domain Context glossary and Context Map entry.
- An ADR describing domain ownership, provider authority, state transitions, launch gates, and contracts.
- A single end-to-end workflow specification with success, late, stale, declined, cancelled, and duplicate paths.
- A small provider onboarding and editorial verification procedure.
- A data minimization and financial responsibility checklist.
- A deterministic interaction route, approved Agent Mode and catalogue plan.
- Acceptance tests tied to observable completed outcomes.

**Decision rule:** Build the smallest reliable path from an accurate listing to a verified customer outcome. Add integration, payments, delivery, or automation only when real demand justifies the full cost.
