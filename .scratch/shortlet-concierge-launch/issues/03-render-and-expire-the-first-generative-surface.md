# Render and safely expire the first Generative Surface

Status: ready-for-agent
Type: AFK
User stories: 94–99, 108–110

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Render one versioned, catalogue-validated A2UI v0.9.1 Generative Surface through the replaceable Weaver-backed Web Agent Adapter. Keep surface lifecycle and action authority platform/application-owned, and demonstrate that expiry, staleness, invalid output, or unsupported presentation removes action authority and provides complete safe fallback. Weaver and A2UI component state remain non-authoritative presentation concerns.

## Acceptance criteria

- [ ] The surface uses A2UI v0.9.1 and the Basic Catalog first; the supported catalogue and version are known and validated, unsupported catalogue or version input fails safely, and custom shortlet catalogues remain deferred.
- [ ] Revisions correlate to authoritative projection versions; lifecycle and action authority remain platform/application-owned, and stale or expired actions fail closed.
- [ ] Unsupported or invalid A2UI/Weaver rich presentation produces safe text plus a conventional route without losing authoritative workflow state.
- [ ] Canonical InteractionArtifact-to-A2UI output and the recorded platform-owned surface lifecycle projection are deterministic; the presentation runtime cannot alter authoritative meaning, and replacing it cannot change application commands or domain semantics.

## Blocked by

- [Issue 01](01-browse-one-eligible-unit.md)
- [Issue 02](02-resume-an-authenticated-interaction-thread.md)
