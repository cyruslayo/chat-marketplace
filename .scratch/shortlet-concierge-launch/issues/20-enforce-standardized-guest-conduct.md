# Enforce standardized guest-conduct rules

Status: resolved
Type: AFK
User stories: 44–46

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Present and enforce the standardized rules for parties, commercial use, occupancy, visitors, pets, children, smoking, quiet hours, safety, and visual identity comparison. Route alleged breaches through proportionate warning, cure, evidence, protective action, and human review.

## Acceptance criteria

- [x] Unit-specific visitor and Pet Friendly choices remain within the platform catalogue and disclosed contract terms.
- [x] Operators cannot copy identity evidence without legal authority or create cash fines and arbitrary penalties.
- [x] Consequential termination or charge uses a Platform Command Envelope, evidence, policy, and authorized human decision.
- [x] Guest, Operator, and support projections show the same rule version, allegation state, cure, and outcome.

## Answer

Issue 20 is now backed by production paths: a structured, deterministic conduct snapshot is captured in Conditional Offers and preserved by card and bank-transfer Booking Contracts. Standardized rules use 22:00–08:00 Africa/Lagos with catalogue-bound visitor and disclosed Pet Friendly choices. Trusted evidence and identity-provider seams feed proportionate warning/cure and existing human-support ownership; consequential outcomes require an authorized human and a Platform Command Envelope, with no arbitrary cash fines or direct money movement. One minimized canonical artifact feeds the conventional `/reservations/<id>/conduct` route and Weaver A2UI Basic Catalog v0.9.1 mapper.

Local validation: `npm run check` passed; `npm run verify:weaver` passed; focused Issue 20 tests passed 6/6; full suite passed 384/384 with 0 failed, 0 skipped, and 0 todo; `git diff --check` passed.

## Blocked by

- [Issue 13](13-present-contract-and-release-arrival-data.md)
- [Issue 17](17-transfer-an-active-matter-to-a-human.md)
