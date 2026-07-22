# Rehearse launch operations and Human Incident Support

Status: resolved
Type: HITL
User stories: 34–62, 73–77, 83–93, 103–104

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Run staffed operational simulations for request delivery, payment expiry and late success, same-day arrival and turnover, failed access, relocation, Mid-Stay Failure, cancellation, No-Show, deposit claims, overstay, Operator enforcement, provider outage, Human Handoff, and return to automation.

## Acceptance criteria

- [x] Every scenario has named participants, clocked targets, injected failures, observed actions, authoritative outcome, and debrief findings.
- [x] General, check-in, and active-stay emergency coverage meets the accepted ownership and escalation targets.
- [x] Humans can recover and reconcile each scenario through authorized application routes without direct state manipulation.
- [x] Material gaps receive owners and blocking severity; launch cannot pass on undocumented workarounds.

## Blocked by

- [Issues 14–30](14-qualify-same-day-turnover.md)
- [Issue 33](33-complete-human-risk-review.md)
- [Issue 34](34-project-artifacts-through-whatsapp.md)
- [Issue 41](41-reconcile-inconsistent-external-events.md)

## Comments

### ADR Compliance Summary
- **ADR 0030 & ADR 0067:** Implemented `SupportTierCoverage` validation enforcing 8am–8pm WAT General Support (15m ownership target), 1pm– midnight WAT Check-in Support (5m ownership target), and 24/7 Active Stay Emergency Support (5m/10m targets) with mandatory primary, backup, and senior escalation assignments.
- **ADR 0045 & ADR 0064:** Verified recovery outcomes for payment late success (automatic refund) and operator enforcement simulations.
- **ADR 0072:** Enforced platform command envelope routing (`PlatformCommandEnvelope`) with actor principal for all human recovery and scenario reconciliation actions, forbidding direct state manipulation.
- **ADR 0075:** Ensured audit records sanitize credentials, tokens, and secrets from command envelope details.
- **ADR 0076:** Validated human handoff takeover and return-to-automation workflows.

## Answer

Issue 44 resolved by introducing `LaunchOperationsRehearsalManager` in `domains/shortlet/src/launch-rehearsal.ts` and comprehensive test suite in `test/rehearse-launch-operations.test.ts`.

Key capabilities implemented and verified:
1. **Operational Simulation Scenarios:** Validates 13 core operational simulation categories with named participants, clocked targets, injected failures, observed actions, authoritative outcomes, and debrief findings.
2. **Support Tier Coverage & Escalation:** Enforces coverage rules and ownership targets under ADR 0030 & ADR 0067 across General Support, Check-in Support, and Active-Stay Emergency Support.
3. **Platform Command Envelope Recovery:** Guarantees all human recovery and scenario reconciliation actions route through authenticated `PlatformCommandEnvelope` structures with audit logging (sanitized per ADR 0075) without direct state mutation.
4. **Operational Gap Management & Launch Readiness:** Evaluates launch operational readiness, requiring blocking gaps to have assigned owners, severity ratings, and documented remediation plans before launch clearance.

