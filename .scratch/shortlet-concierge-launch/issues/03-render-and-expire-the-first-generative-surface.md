# Render and safely expire the first Generative Surface

Status: ready-for-agent
Type: AFK
User stories: 94–99, 108–110

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Render one versioned, catalogue-validated A2UI Generative Surface through the Web Agent Adapter, update it through ordered AG-UI projection events, and demonstrate that expiry, staleness, invalid output, or unsupported catalogue negotiation removes action authority and provides complete fallback.

## Acceptance criteria

- [ ] The surface uses the pinned interaction profile and an approved catalogue known at deploy time.
- [ ] Revisions correlate to authoritative projection versions and stale or expired actions fail closed.
- [ ] Unsupported or invalid rich UI produces safe text plus a conventional route without losing workflow state.
- [ ] The same recorded stream renders equivalent normalized meaning in CopilotKit and an independent reference client.

## Blocked by

- [Issue 01](01-browse-one-eligible-unit.md)
- [Issue 02](02-resume-an-authenticated-interaction-thread.md)
