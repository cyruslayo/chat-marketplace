# Onboard and publish one inspected Operator Unit

Status: resolved
Type: AFK
User stories: 2, 63–68, 83–84

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Onboard one registered Operator and entire-place Unit, capture responsible persons, settlement identity, Management Authority, regulatory and insurance evidence, complete the Physical Inspection checklist, and publish only while every eligibility requirement remains valid through the possible checkout date.

## Acceptance criteria

- [x] Publication fails unless Operator, Unit, authority, inspection, licensing, insurance, and settlement requirements pass.
- [x] Expiry and Material Unit Change make affected future inventory ineligible; scheduled reinspection grants no provisional eligibility.
- [x] Inspectors can record the accepted safety, accuracy, possession, privacy, utility, sanitation, and media evidence.
- [x] Operators and staff see actionable status without exposure of unnecessary raw verification evidence.

## Completion note

Issue 04 is implemented with authoritative Operator and Unit publication eligibility, Management Authority and regulatory checks, complete Physical Inspection scope, Material Unit Change invalidation, actionable status projection, and expiry coverage through the latest checkout permitted by the existing booking horizon.

Publication reuses the existing 90-day latest check-in and 14-night maximum-stay policy, so time-bounded Operator approval, inspection, Management Authority, licensing, and insurance must remain valid through the furthest possible checkout.

Validation: 310 tests passed, 0 failed across 4 suites; focused onboarding and browse tests, Weaver vendor verification, and TypeScript checks passed.

## Blocked by

- [Issue 01](01-browse-one-eligible-unit.md)
