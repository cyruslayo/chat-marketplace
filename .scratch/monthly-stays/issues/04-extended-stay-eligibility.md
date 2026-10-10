# Extended Stay eligibility: length, opt-in and validity through checkout

Status: ready-for-agent
Type: task
Blocked by: 03

## What to build

Let the authoritative booking service accept an Extended Stay alongside the Short Stay. Short Stay behaviour must not change.

- Classify a requested stay as Short Stay or Extended Stay from its length, using ADR 0092's limits held as configuration. Do not add new number literals beside `MAX_STAY_NIGHTS` in `domains/shortlet/src/browse.ts`; inject the Extended Stay limits (AGENTS.md anti-pattern 3).
- Reject lengths outside both ranges before search, quoting, identity verification, inventory blocking or payment, matching how `booking-request.ts` rejects them today.
- A unit is eligible for an Extended Stay only if it has opted in (ADR 0092, "Units").
- Physical Inspection, Management Authority and regulatory validity must cover every night through Contractual Checkout (ADRs 0056, 0057, 0009, 0065). Recheck at search, draft, disclosure, confirmation and payment initialisation (ADR 0055).
- Continuous Occupancy aggregation (ADR 0023) still applies to Short Stays. Back-to-back Short Stays cannot add up to an Extended Stay length.
- Capture the stay type in the Stay Quote and the Booking Contract snapshot.

## Acceptance criteria

- AC1: A request whose length is inside the Extended Stay range, at an opted-in unit, is accepted as an Extended Stay and the stay type is snapshotted.
- AC2: A request inside the Extended Stay range at a unit that has not opted in is rejected before quoting.
- AC3: A request whose length is in neither range (15–29 nights, or more than 90) is rejected before quoting, identity verification, inventory blocking or payment.
- AC4: An Extended Stay whose checkout falls after the unit's inspection or management-authority expiry is rejected at each recheck point, and a loss before payment releases inventory and takes no money.
- AC5: Adjacent Short Stays for the same Primary Guest at the same property are still refused once the combined occupancy passes fourteen nights.
- AC6: Every existing Short Stay length and horizon test passes unchanged.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0092 | Extended Stay range, unit opt-in |
| 0023 | Short Stay 1–14 nights, Continuous Occupancy, no fragmentation |
| 0055 | 90-day horizon on check-in; rechecks |
| 0056, 0057, 0009, 0065 | Validity through Contractual Checkout |

## Definition of Done

See `docs/agents/issue-tracker.md`: one named test per AC with failure paths, ADRs cited, no invented constants, no secrets in logs, and `npm run check` and `npm test` green.

## Comments
