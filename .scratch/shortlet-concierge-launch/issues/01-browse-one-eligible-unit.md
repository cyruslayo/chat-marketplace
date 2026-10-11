# Browse one eligible Unit through conventional and conversational web

Status: resolved
Type: AFK
User stories: 1–3, 12, 94, 105, 108

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Deliver the first executable tracer: seed one eligible Lagos or Abuja Unit, search it through an authoritative application query, and present the resulting canonical InteractionArtifact through both a conventional web result and a web-agent result. The web-agent presentation deterministically maps the artifact to supported A2UI v0.9.1 through the replaceable Weaver-backed Web Agent Adapter/runtime boundary. Keep the domain result independent of both presentation paths; Weaver is not part of the domain or application contract.

## Acceptance criteria

- [ ] Date, party-size, location, amenity, and basic price filters return only eligible matching Units.
- [ ] Conventional and web-agent results derive from the same authoritative InteractionArtifact/projection and expose equivalent facts.
- [ ] The web-agent presentation deterministically maps the artifact to supported A2UI v0.9.1 through the replaceable web adapter/runtime boundary.
- [ ] The slice includes persistence, application query, web presentations, audit/telemetry, and behavioural tests.
- [ ] Web presentation/runtime framework types do not enter the Domain Pack or authoritative application contracts.

## Blocked by

None - can start immediately.

## Comments
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Evidence: test/browse-one-eligible-unit.test.ts (reconciliation reports 15/15 pass): `:20` filters return eligible Units (AC1); `:121` default web-agent presentation is deterministic A2UI with conventional parity (AC2, AC3); `:96` unit persistence survives a repository instance (AC4); `:164` search records audit and telemetry (AC4); `:178` application contract contains no CopilotKit dependency (AC5). Web-agent *-a2ui.ts presenters as the reconciliation cited them. Landing: 1368070 ("Implement browse eligible shortlet unit tracer", 22 Jul 2026); the file was migrated to TypeScript in 47c72db.
  - Gaps: AC5 has no test named after it: `:178` covers it by content, not by name. The test-to-criterion mapping is by name and line, and was not re-run here. The issue has no ADR compliance table and no Answer section.
  - Not verified: `npm run check` and `npm test` were not re-run in this reconciliation, and the Definition of Done was not ticked item by item. The acceptance criteria boxes in this file are still unticked; the Definition of Done items were not re-verified.
