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
