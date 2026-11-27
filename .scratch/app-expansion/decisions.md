# Decisions

Agents do not decide these. "Recommended" is a proposal until the owner answers. Reply "accept all", or by number.

## Settled

| # | Decision | Date |
| --- | --- | --- |
| A1 | Expand beyond chat and move the whole UI to the Xenia kit in the same programme | owner, 25 Nov 2026 |
| A2 | Use rules-first checking for money, deadlines and cross-feature rules; write the plan with it built in | owner, 25 Nov 2026 |
| A3 | Work from `main` | owner, 25 Nov 2026 |
| A4 | Concierge chooser and tier C suggestion; tiers A and B off | owner, 16 Nov 2026 (agent-modes) |
| A5 | No guest names on Operator screens; "Decline"; "Owner payouts"; "Confirm payment" | owner, 21 Nov 2026 |
| A6 | Adire Indigo, Newsreader, Hanken Grotesk, values and voice | owner, 20 Nov 2026 |

## Accepted by the owner, 25 Nov 2026

The owner accepted the recommendation in each row as written.

| # | Question | Accepted answer | Why | Unblocks |
| --- | --- | --- | --- | --- |
| D1 | Bring the four `docs/ux-guidelines` commits here, keeping `main`'s version of weaver-catalogues 04–07? | Yes | ADR 0108, the surface plan and the kit audit are cited but missing on `main` | 01 |
| D2 | Build Stays only, on a frame the other domains can use? | Yes | No other domain has an ADR, vocabulary or code | 08, 10, map |
| D3 | A guest cancels while a change is unfinished. Which wins? | Cancellation. An unpaid change closes with no charge. A change whose payment is in flight is settled first, then refunded with the stay | The trial charged 10,000 kobo after cancellation | 04, 05 |
| D4 | Who finishes a half-done cancellation? | The system retries the ledger and date release on the next read or staff action. The refund becomes a recorded obligation that staff complete with the Paystack refund reference, as an upheld complaint does today. The guest sees "Cancelled" and the refund's state | Pilot refunds are manual (`docs/policy/shortlet-pilot-payments.md`); nothing resumes today | 05 |
| D21 | May a signed-in second device open and act on its own request, offer and booking pages? (guest-accounts 13) | Yes, as that issue proposes: built from the records, strangers keep the identical 404 | Emails and the list lead to a refusal without it | 11, 13 |
| D22 | Commit your uncommitted one-line AGENTS.md fix (Payment Window starts at Operator confirmation)? | Yes | `main` still tells agents it starts at Accept Offer. The code and ADR 0044 agree with you | 06 |
| D23 | Period Payment in flight or verified after cancellation (rules 01 Q1, Scenario 6)? | Cancellation wins (extends D3, ADR 0045, ADR 0092): an in-flight Period Payment settles first; any Period Payment verified after cancellation is recorded for manual refund and never marks the period paid or revives the stay | Prevents collecting and holding Period 2 money on a cancelled Reservation and keeps S2 uniform across first and later payments | 06, 17, 22 |
| D24 | Period Payment in flight when Notice to End arrives (rules 01 Q2)? | Refuse Notice to End while a Period Payment is in flight (until it settles or expires); if a late verification still arrives after Notice to End is recorded, record every paid night after `newLastNight` (or the whole payment if the period was cut out) for manual refund | Ensures Notice to End calculates `refundKobo` and `owedKobo` against settled payments while closing the late-webhook race | 06, 17, 19, 22 |
| D25 | Blocking Fulfilment Complaint upheld while a Booking Amendment is unpaid or its payment is in flight (rules 01 Q3, Scenario 7)? | Upholding the complaint wins (mirrors D3): an unpaid Booking Amendment closes with no charge and the upheld refund uses the captured nights; an in-flight change payment settles first and is recorded for full refund alongside the upheld stay refund | Under ADR 0091 an upheld complaint ends the stay from the first affected night; a stay ended for Operator failure must never collect new money | 06, 04, 19, 20 |
| D26 | Blocking Fulfilment Complaint upheld while a Period Payment is in flight (rules 01 Q4)? | Upholding the complaint wins (ADR 0091): the in-flight Period Payment settles first and, for any period starting on or after the first affected night, is recorded for full manual refund without marking the period paid, reviving the stay, or creating a Period Owner Payable | Keeps S2 and S6 consistent between cancellation and upheld complaints on Extended Stays | 06, 20, 22 |
| D27 | Blocking Fulfilment Complaint upheld after Notice to End is recorded (rules 01 Q5)? | The upheld complaint ends the remaining stay from the first affected night through `newLastNight` (ADR 0061, ADR 0091, ADR 0092): refund only paid nights not already refunded by Notice to End (S4), cancel any `owedKobo` for unpaid nights on or after the first affected night, and reduce Period Owner Payables accordingly | Preserves the guest's ADR 0061 failure remedy during the notice period while enforcing conservation (no double refund) | 06, 19, 20 |
| D28 | Accept Proposed S4 (conservation sum rule) and P2 (all manual refunds on Operator home) (rules 01 Q6)? | Yes: accept S4 ("Total refunded never exceeds total paid, per payment and per booking") and P2 ("Every recorded refund shows on the Operator home until it is paid", covering cancellation, upheld complaint, Notice to End, late Period Payment, and superseded-reference refunds) | Pilot refunds are manual (`docs/policy/shortlet-pilot-payments.md`, D4); any recorded refund absent from the Operator home risks going unpaid, and S4 prevents double-refunds | 06, 05, 18 |
| D29 | Accept Proposed S1 as one rule across `cancelled` and `no_show` Reservations (rules 01 Q7, Scenario 5)? | Yes: once a Reservation is `cancelled` or `no_show`, any waiting Extension closes, and `Extension approve`, `Notice to End`, and `Complaint upheld` are refused (no contract change, no second refund). Any post-cancellation failure override uses reviewed liability adjustment, not a second stay-ending command | Prevents a cancelled Reservation from mutating its dates, generating a second Owner Payable reduction, or creating duplicate refund obligations | 06, 04, 05, 18, 19 |
| D30 | Open Blocking Fulfilment Complaint against Booking Amendment commit and Extension approve (rules 01 Q8)? | Refuse `Change commit` and `Extension approve` while a Blocking Fulfilment Complaint is open (matching S12 for Notice to End), and close any waiting Extension if the complaint is upheld; if dismissed, the guest may proceed or re-request | Prevents adding nights or collecting extra money on a stay with an unresolved failure, keeping S12 consistent across all stay-changing actions | 06, 19, 20 |
| D31 | Accept P3 (every proposed or accepted Booking Amendment must end) (rules 01 Q9)? | Yes: accept P3; non-extension Booking Amendments must carry an explicit expiry deadline bound to existing ADR 0060 cutoffs / Payment Window when wired in issue 19 | Prevents unpaid amendments from staying open indefinitely and colliding with check-in or checkout | 06, 19 |
| D32 | AC3 scope for deposit claims, relocation, and No-Show (rules 01 Q10)? | Add a dated note deferring deposit-claim rows (ADR 0016–0020; zero deposit in pilot, ADR 0089, ADR 0092) and relocation rows (ADR 0028–0029; refund-only in pilot while Guest Protection Fund is out of launch scope, ADR 0089, ADR 0091); add a No-Show row governed by S1 and S2 (ADR 0058) | Satisfies AC3 accurately without inventing rules for features disabled in the pilot, while closing the active `no_show` state | 06 |
| D33 | Sequencing of surface-kit Follow-ups A–C vs Phase 2b (issue 02 decision 1)? | Land Follow-ups A–C after 2b-05 and 2b-06, before Phase 3 | 2b-05/2b-06 share the serial files (`shortlet-runtime.ts`, `dist/client.js`); landing after avoids overlap and keeps Phase 3's first new A2UI component on a reviewed base | Follow-ups A, B, C |
| D34 | Wrap the 9 typed components as Tier 3 on `v1` now, or rename to Tier 1/2 immediately (issue 02 decision 2)? | Tier 3 on `v1` with byte-identical wire (zero open-chat breakage); glossary-clean Tier 1/2 renames deferred to `v2` under ADR 0073 | Preserves 100% wire byte-identity for open chats while ADR 0108 phase 2 reviews promotions against commerce | Follow-up B, 2b-05, 2b-06 |
| D35 | Adapter hook for the 6 relationship/policy/callback components (issue 02 decision 3)? | Extend `apps/local-guest/src/catalogue-renderers.ts` (`rendererRegistrationsFor`) to accept per-alias host-aware renderers, keeping `packages/surface-kit` Weaver-free (ADR 0081) | Avoids redesigning `UnitDetail`, `StayCard`, `StayResults`, `StayComparison`, `UnitGallery` and `UnitActionBar` to remove Weaver relationships now | Follow-up A |
| D36 | Lifecycle of `feat/surface-kit-phase-1` (issue 02 decision 4)? | Supersede it via Follow-ups A–C and leave it unmerged/archived | Its content lands as reviewed cherry-picks resolved against the current code; merging the branch directly would replay 14 git + 3 semantic conflicts | Follow-up C |
| D5 | Install a modelling tool? | No. Revisit after rules page 02 | The plain checks already find defects | – |

## Open: needed before phase 3

| # | Question | Recommended | Blocks |
| --- | --- | --- | --- |
| D6 | What is the support contact, who covers it, and when? | One monitored phone and WhatsApp line plus the in-app form (launch-readiness 09). Until it exists, no screen promises cover | 16, 20 |
| D7 | When is the address released? | Address after payment, access instructions after the identity check. Needs the procedure (launch-readiness 08) and an ADR to settle 0066 against 0085 | 21 |
| D8 | Does Your stays work without sign-in, on this device's own session? | Yes, after a shared-device review. Changes guest-stays 04 AC1 | 11 |
| D9 | Does it list open requests and expired offers? | Yes. Changes your 3 October answer (confirmed only) | 11 |
| D10 | Name and address | "Your stays" now, "Your plans" when a second domain is live; address `/plans` from the start | 11 |
| D11 | Turn email on for sign-in and guest emails, starting with staging? | Yes. Owner runs the deployment | 13 |
| D12 | Order of other domains | Events, Services (first inside Stays), Community last. Draft the Events ADR now, no screens until accepted | 26 |
| D13 | How a guest is told the concierge is automated | "The concierge is automated software. When a question needs a person, it goes to our team." The second sentence only once D6 is true | 08, 16 |
| D14 | Rename scope | Guest-facing copy only for now. Trademark check before public launch | Phase 2b copy; no issue yet |
| D15 | Delay public sign-in until account deletion works? | Yes for a public launch, no for the invited beta | Launch gate; no issue yet (guest-accounts 10) |

## Open: needed before phase 4

| # | Question | Recommended | Blocks |
| --- | --- | --- | --- |
| D16 | Self-service cancellation with the exact refund shown first? | Yes, staff pay the refund | 18 |
| D17 | One way to change dates, or three? | Keep extension and Notice to End for Extended Stays; use Booking Amendment for Short Stays. Show one "Change or cancel" page | 19 |
| D18 | Who reads a guest's problem report, and how fast? | The D6 rota, using ADR 0061 categories. No timing shown until staffed | 20 |
| D19 | Receipt fields | Counsel (monthly-stays 02, 10) | 22 |
| D20 | Refund wording while a refund is pending | Draft goes through the Language page | 18 |

## Still open elsewhere

state-machines 25, 27, 28 and PRD questions 1, 3, 4. This plan depends on 27 (payment-stage guards) for rules page 01.
