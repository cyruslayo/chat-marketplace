# 06 · Enforce Continuous Occupancy across back-to-back stays

Status: ready-for-agent
Type: task
Blocked by: 04 (resolved)
Requested: 1 Nov 2026

## What to build

ADR 0023 and ADR 0092 (amendments of 1 Nov 2026) cap **Continuous Occupancy**, not just single bookings, but no code adds up back-to-back stays today. Using the owner's decisions in issue 04:

- **Chain.** For a new or changed stay, find the guest's other *counted* stays at the same Property (`Unit.propertyId`, any Unit) by the same Primary Guest account whose checkout equals this stay's check-in, or whose check-in equals this stay's checkout, and follow the chain both ways. A gap of one night or more ends it.
- **Counted stays**: stays that still hold or will hold the nights: a submitted Booking Request awaiting the Operator, an open Conditional Offer, a confirmed Reservation (and any equivalent held state you find). Not counted: declined, expired, withdrawn, cancelled, superseded drafts. List the exact states you count, with file and line, in Comments.
- **Rules** (total = nights of the whole chain including the new stay):
  - every stay in the chain is a Short Stay → total ≤ `MAX_STAY_NIGHTS` (29);
  - any stay in the chain is an Extended Stay → total ≤ the policy's `maximumNights` (180).
  Take both limits from the existing constant and policy; add no new constant.
- **Where.** Booking Request draft creation and submission (`domains/shortlet/src/booking-request.ts`), and Booking Amendments that change dates (`booking-amendment.ts`). Refuse before any inventory hold, quote acceptance or payment, as ADR 0023 requires. Fail closed: if a counted stay's Property or Primary Guest cannot be resolved, refuse rather than skip it.
- **Message.** Reuse an existing refusal pattern if one fits. Otherwise use: "These dates join another stay of yours at this property, making {total} nights. A stay of 30 nights or more must be booked as one Extended Stay." (Short chain) and "These dates join another stay of yours at this property, making {total} nights, more than the {max}-night maximum." (Extended chain). Mark both in Comments as **wording for the owner to confirm**.
- **Guest surfaces.** The concierge and assistant must report the refusal as a normal refusal (assistant: `tool_denial`, never `CONCIERGE_UNAVAILABLE`, ADR 0106).

## Acceptance criteria

- AC1: A guest with a confirmed 20-night Short Stay at Property P cannot submit a Booking Request at another Unit of P that checks in on that checkout date for 10 nights (30 in total); the refusal names the total, and no nights are held.
- AC2: The same guest can book 9 nights there (29 in total).
- AC3: A one-night gap breaks the chain: 20 nights, a gap night, then 20 nights is allowed.
- AC4: A different guest account, or a different Property, is never added to the chain.
- AC5: Declined, expired and cancelled stays are not counted; a pending Booking Request and an open Conditional Offer are counted.
- AC6: A chain that includes an Extended Stay may reach 180 nights and is refused at 181.
- AC7: A Booking Amendment that extends a stay into a chain over the limit is refused.
- AC8: With the assistant runtime enabled and a cold restore before every event (AGENTS.md "Concierge assistant path"), the AC1 refusal reaches the guest as a refusal, not `CONCIERGE_UNAVAILABLE`.

## ADR compliance

| ADR | Constraint | Where it bites |
|---|---|---|
| 0023 (amended 1 Nov 2026) | Continuous Occupancy across Units and reservations; Short Stays ≤ 29; refuse before search, quoting, blocking or payment | All ACs |
| 0092 (amended 1 Nov 2026) | Chain with an Extended Stay ≤ 180 | AC6 |
| 0060 | Amendments are versioned and validated | AC7 |
| 0106 | Refusals are `tool_denial`, cold restore per event | AC8 |
| 0075 | No guest identifiers in refusal text or logs | Message, audit |

## Definition of Done

See `docs/agents/issue-tracker.md`. Record the exact test commands and pass counts in Comments.

## Comments
