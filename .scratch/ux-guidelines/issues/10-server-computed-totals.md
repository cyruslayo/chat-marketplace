# 10 · Server-computed total plus deposit in discovery

Status: ready-for-human
Type: grilling
Blocked by: none
Phase: 1 (Batch A)
Applicable ADRs: 0015, 0102; guideline §10 price hierarchy

## What to build

`apps/web-agent/src/discovery-a2ui.ts:147-148` adds the All-In Stay Total and the deposit to build the budget note. The guideline says totals come from the domain projection only. Decide with the owner:

1. Add a projected `amountDueAtPaymentKobo` (or the existing equivalent) to the discovery projection in `domains/shortlet` and render it; or
2. Record that presentation-level addition of two projected amounts is allowed under ADR 0015, and add a test pinning it to the projection fields.

Note: the landing page's `DUE_KOBO` (`landing-page-html.ts:69`) is static demo copy and is out of scope.

## Acceptance criteria

1. The owner's decision is recorded here and in map.md
2. If option 1 is chosen, a follow-up task issue is written
3. If option 2 is chosen, the pinning test exists

## Rules

- Grilling: ask the owner. Change no code until they decide.

## Comments
