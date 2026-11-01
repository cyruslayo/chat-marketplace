# 04 · Decide how Continuous Occupancy is enforced

Status: resolved
Type: grilling
Blocked by: none
Requested: 1 Nov 2026

## Why

ADR 0023 (amended 1 Nov 2026) says adjacent Short Stays by the same Primary Guest or materially the same party, at the same property, may not add up to more than 29 nights; anything longer must be booked as one Extended Stay. ADR 0092 caps any Continuous Occupancy that includes an Extended Stay at 180 nights.

A search of `domains/shortlet/src` on 1 Nov 2026 found **no code that aggregates adjacent reservations**: each stay is checked on its own length only. Before the limit rises to 29 nights, the gap matters more: two back-to-back 29-night Short Stays (58 nights) would avoid the Extended Stay contract, its Billing Periods and its terms.

## To decide (recommendation first)

1. **Scope of "same party".**
   - (a) Recommended: same Primary Guest account only, for the pilot. Detecting "materially the same party" across accounts needs identity data the pilot does not collect online.
   - (b) Same Primary Guest, or a shared payer or phone number.
2. **What counts as adjacent.**
   - (a) Recommended: a new check-in on the checkout date of an existing confirmed or pending stay at the same unit or property.
   - (b) A gap of up to N nights also counts (N to be set).
3. **Where it is enforced.** At Booking Request submit and at amendment, refusing with a reason that tells the guest to book one Extended Stay instead.

When answered, this becomes a task issue (05) with acceptance criteria.

## Answer

Owner decision, 1 Nov 2026 (all three recommendations):

1. **Same party** = the same Primary Guest account. Bookings by different accounts are never added together in the pilot.
2. **Adjacent** = a check-in on the checkout date of another counted stay (same-day handover), in either direction. Chains of several stays are added up end to end. A gap of one night or more breaks the chain.
3. **Where** = the whole Property (`Unit.propertyId`), across Units, as ADR 0023 says ("aggregated across units").

Enforcement goes to issue 06.

## Comments
