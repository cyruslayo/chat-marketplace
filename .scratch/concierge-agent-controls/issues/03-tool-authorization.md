# Enforce tool schemas, turn capabilities, and authorized references

Status: ready-for-agent
Blocked by: 02

## What to build

Implement control 3 and ADR 0106 at the platform tool-execution boundary.
Treat classifier and planner output as untrusted suggestions.
Validate the complete declared schema locally, including required fields, nullable types, ranges, arrays, and extra properties.
Intersect active-pack tools, current-state tools, validated turn capabilities, and server authorization.
Keep principal, tenant, guest, and command context server-owned.
Retain current domain eligibility, capacity, price, reference, stale-action, confirmation, concurrency, and idempotency checks.
Route consequential effects through the existing platform command gate; do not create a parallel authorization system.
Do not add approval prompts to authorized public reads.

## Acceptance criteria

- [ ] AC1: Unavailable tools, unknown names, extra arguments, missing fields, invalid types, and invalid ranges produce recoverable tool errors without effects.
- [ ] AC2: A classifier that approves an attack cannot grant another pack's tools, admin actions, or capabilities outside the validated turn.
- [ ] AC3: Forged guest/tenant identities and references outside the authorized current state cannot read or mutate another guest's workflow.
- [ ] AC4: Price/date/eligibility checks and exact-effect confirmation remain enforced for draft and proposal operations.
- [ ] AC5: Stale surfaces, changed facts, duplicate confirmations, and racing effects retain command-gate rejection and idempotency.
- [ ] AC6: Valid existing shortlet and development-commerce tool behavior remains supported; public commerce stays off.

## ADR compliance

Use PRD's ADR map and ADR 0106. Exercise real tool boundaries and observable domain effects with deliberately hostile model/guard doubles.

## Comments

Record commands, pass counts, commit, and Definition of Done evidence.
