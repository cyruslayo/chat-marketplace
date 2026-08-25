# Verify access with live check-in support

Status: resolved
Type: AFK
User stories: 34–37

## ADR Compliance
- ADR 0021 & 0076: Protection window starts after Verified Access; blocking complaints hold exposed revenue.
- ADR 0022: Independent evidence hierarchy enforced; operator assertion or chat state alone cannot declare Verified Access.
- ADR 0030 & 0031: Human incident support required for check-in window (14:00 to 22:00 WAT). Late voluntary arrival vs failed access produce distinct outcomes.

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Guide arrival within 2:00 PM–10:00 PM WAT, maintain live Human Incident Support throughout the Contractual Check-In Window, determine Verified Access from the accepted evidence hierarchy, and open a Blocking Fulfilment Complaint when credible access or habitability failure prevents release.

## Acceptance criteria

- [x] Arrival boundaries, support ownership, evidence requests, and escalation are visible and auditable.
- [x] Verified Access follows independent evidence priority and cannot be declared by Operator assertion or chat state alone.
- [x] Blocking complaints hold exposed revenue and preserve the current incident context for human review.
- [x] Late voluntary arrival and actual failed access produce distinct outcomes under the accepted policy.

## Blocked by

- [Issue 13](13-present-contract-and-release-arrival-data.md)

## Answer

- The contractual arrival window is authoritative and represented in Africa/Lagos.
- Human Incident Support assignment and coverage are trusted server state.
- The Primary Guest can confirm access or report a bounded incident through one application boundary.
- Verified Access follows the ADR 0022 evidence hierarchy; Operator assertion and chat cannot independently verify access.
- Protection-window start follows the later-of rule, with the voluntary late-arrival exception only on positive trusted evidence.
- Blocking complaints request human ownership and prevent Revenue Release through authoritative complaint state.
- Conventional and Weaver presentations share a minimized canonical artifact.
- Final local validation totals: focused suite 27 passed, 0 failed; full suite 373 passed, 0 failed, 0 skipped, 0 todo.
