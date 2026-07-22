# Qualify a Unit for Same-Day Turnover

Status: ready-for-agent
Type: AFK
User stories: 73–75

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Let Operations grant Same-Day Turnover as an earned Unit capability, require a Turnover Plan and observed qualification evidence, create each Turnover Run, enforce its Readiness Deadline, and suspend or restore eligibility under the accepted graduated rules.

## Acceptance criteria

- [ ] Units without active qualification cannot expose same-day arrival inventory after checkout.
- [ ] Every Turnover Run has a plan, responsible Operator, evidence, deadline, readiness state, and audit trail.
- [ ] A missed deadline initiates the defined incident workflow and immediately protects incoming availability.
- [ ] Restoration and revocation use the accepted defect, serious-failure, recurrence, and egregious-failure thresholds.

## Blocked by

- [Issue 04](04-onboard-and-publish-one-inspected-unit.md)
- [Issue 05](05-block-and-hold-unit-availability.md)
