# Browse one eligible Unit through conventional and conversational web

Status: ready-for-agent
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
