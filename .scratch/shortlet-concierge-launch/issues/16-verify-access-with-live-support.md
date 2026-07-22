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

- [ ] Arrival boundaries, support ownership, evidence requests, and escalation are visible and auditable.
- [ ] Verified Access follows independent evidence priority and cannot be declared by Operator assertion or chat state alone.
- [ ] Blocking complaints hold exposed revenue and preserve the current incident context for human review.
- [ ] Late voluntary arrival and actual failed access produce distinct outcomes under the accepted policy.

## Blocked by

- [Issue 13](13-present-contract-and-release-arrival-data.md)
