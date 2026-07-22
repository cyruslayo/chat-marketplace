# Replay, observe, and restore interaction streams independently of CopilotKit

Status: ready-for-agent
Type: AFK
User stories: 95–96, 104, 108–110

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Implement the pinned AG-UI interaction profile as an ordered, at-least-once, replayable stream with deduplication, gaps, snapshots, compaction, heartbeat, reconnect, tracing, limits, timeouts, and safe cancellation. Prove normalized equivalence through CopilotKit and the independent reference client.

## Acceptance criteria

- [ ] Registered events and A2UI carriage follow the profile; unknown custom and all raw production events are rejected.
- [ ] Duplicate, conflicting duplicate, gap, reconnect, compaction, late tool, timeout, cancellation, and backpressure fixtures behave deterministically.
- [ ] Golden streams produce equivalent visible facts, actions, deadlines, fallback, accessibility semantics, and Platform Commands in both clients.
- [ ] Provisional SLOs and limits are instrumented without using sensitive data as metric labels.

## Blocked by

- [Issue 02](02-resume-an-authenticated-interaction-thread.md)
- [Issue 03](03-render-and-expire-the-first-generative-surface.md)
- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
- [Issue 17](17-transfer-an-active-matter-to-a-human.md)
