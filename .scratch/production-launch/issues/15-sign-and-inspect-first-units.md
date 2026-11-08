# Sign and inspect the first 10-20 units, with their operations pack

Status: ready-for-human
Type: task
Blocked by: 13
Requested: 8 Nov 2026
Wraps: [pilot-launch-readiness/05](../../pilot-launch-readiness/issues/05-sign-and-inspect-first-units.md), [pilot-launch-readiness/06](../../pilot-launch-readiness/issues/06-unit-operations-pack.md)

## Parent

[PRD](../PRD.md). No units, no launch: production refuses the demo inventory (ADR 0105).

## What to do (owner)

- Sign operator agreements and inspect 10-20 units in one or two Lagos neighbourhoods (pilot 05).
- Every unit's Contractual Check-In Window starts at **14:00** (D7, issue 08).
- Prepare the per-unit operations pack (pilot 06): access, cleaning, turnover.
- Fill a production inventory CSV in the same format as `apps/cloudflare/demo/inventory.csv`, with real trust fields and expiry dates; keep it out of the repository if it holds personal data.

## Acceptance criteria

- [ ] AC1: Pilot 05 and 06 criteria met with real evidence (signed agreements, inspection dates).
- [ ] AC2: The inventory CSV imports into a staging dry run with no refusals (an agent can run this against staging with synthetic contact data).

## Comments
