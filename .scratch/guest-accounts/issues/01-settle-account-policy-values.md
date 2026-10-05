# Settle the account policy values

Status: resolved
Type: grilling
Blocked by: none (needs the user)
Requested: 2 Oct 2026

## Why

The coding standards forbid invented policy strings and thresholds (`docs/agents/coding-standards.md`, Definition of Done item 5). Every number below shapes ADR 0093/0094 and the authority in issue 04, and none is fixed by an existing ADR or `CONTEXT.md`. ADR 0086 gives the Operator equivalents (30-minute token, 12-hour session), but Guests sign in from email on a phone, so the answers may differ.

## Question for the user

1. **Sign-in code.** Length and alphabet (e.g. 6 digits), lifetime, number of wrong attempts before the code dies, and how often a new code can be requested per email and per client address.
2. **Session lifetime.** How long a Guest Account Session lasts before the Guest must sign in again (absolute, non-sliding as in ADR 0086)?
3. **Check-in.** Must a Reservation belong to a Guest Account before check-in identity verification can start? (Recommended: yes. An anonymous booking is claimed by signing in on the device that made it, or by the email on the booking contract.)
4. **Merging.** When a device principal that already has threads or bookings signs into an account that has its own, do both sets simply appear together (recommended), or is anything refused?
5. **Claim by email.** May a booking made anonymously on a lost device be claimed by proving the contact email recorded on its Booking Request? (Recommended: yes, through the same code flow.)
6. **Retention and deletion (NDPA 2023).** On account deletion, which records are deleted, which are anonymised (bookings, payments, owner payables, audit), and for how long are they kept? What does "download my data" include?
7. **Assurance labels.** What does a Guest see for each assurance level (e.g. "Email confirmed", "Identity not yet checked")?

## Acceptance criteria (after the answer)

- AC1: Every answer is recorded under `## Answer` with the date.
- AC2: `PRD.md` "Open policy values" is replaced by the settled values, each pointing at this issue.
- AC3: Issues 02, 03, 04, 09 and 10 are updated where an answer changes their scope.

## Answer

Approved by the user on 3 Oct 2026 (recommendations accepted as given).

1. **Sign-in code.** 6 digits (0–9), valid 10 minutes, dead after 5 wrong attempts. A new code may be requested once per 60 seconds, at most 5 per email per hour and 20 per client address per hour. Requesting a new code invalidates any earlier unused code for that email and purpose. Reason: easy to type on a phone, 10 minutes covers slow email delivery, 5 tries against 10^6 makes guessing impractical.
2. **Session lifetime.** 30 days absolute, non-sliding. A fresh code (step-up) is required to change email, delete the account or download data. Reason: Guests mostly read their own history; Operators keep 12 hours (ADR 0086) because they act on money and units.
3. **Check-in.** Yes: a Reservation must belong to a Guest Account before check-in identity verification can start.
4. **Merging.** Show both sets together and refuse nothing. The only refusal: a principal already linked to a different account cannot be linked to a second one.
5. **Claim by email.** Yes. After proving an email with a code, Booking Requests whose recorded contact email equals it are linked to the account (their principals become Linked Principals).
6. **Retention, deletion, export.**
   - Export: account details, stays, Booking Requests, Stay Message Threads, reviews, Saved Stays and concierge conversations, as one JSON file.
   - Delete removes: concierge conversations, Saved Stays, contact details, sessions, codes.
   - Delete keeps, with name and contact removed: Booking Requests, offers, contracts, Reservations, payments, refunds, owner payables and payouts, for 6 years.
   - Delete keeps, with the Guest's name removed: Stay Message Threads (the Operator is a party) and published reviews.
   - Delete is refused while a payment is in progress, a stay is upcoming or in progress, or a deposit claim or appeal is open.
   - **Provisional:** the 6-year period and the anonymise-vs-delete split must be confirmed by a lawyer under the Nigeria Data Protection Act 2023 before issue 10 starts (consistent with ADR 0075's provisional retention).
7. **Assurance labels.** "Email confirmed", "Phone added", "ID not checked yet – we'll do this before check-in", "ID checked". No "KYC" wording and no generic "Verified" badge (ADR 0066).

## Comments

- 3 Oct 2026: answers applied to `PRD.md` ("Settled policy values"), issues 05 and 10, and the slice order in `map.md`.
- 4 Oct 2026: supplemental decisions for implementation. (a) Identity assurance records require authoritative `verifiedAt` and `expiresAt`; no default freshness duration is approved, and ADR 0084's proposed 180 days remains unapproved. (b) Email proof on a lost device grants only the matching Booking Request and its causally related records; it does not link the whole old principal or expose unrelated conversation/history. (c) Code checks are limited to 25 per normalized email per hour and 100 per client address per hour, configurable, in addition to five wrong attempts per challenge. These check budgets are shared across purposes and tenant contexts and supplement the approved code-send limits. See authentication ADR 0093 and assurance ADR 0094.
