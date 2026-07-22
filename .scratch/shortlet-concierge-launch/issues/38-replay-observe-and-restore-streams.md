# Replay, observe, and restore interaction streams independently of CopilotKit

Status: resolved
Type: AFK
User stories: 95–96, 104, 108–110

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Implement the pinned AG-UI interaction profile as an ordered, at-least-once, replayable stream with deduplication, gaps, snapshots, compaction, heartbeat, reconnect, tracing, limits, timeouts, and safe cancellation. Prove normalized equivalence through CopilotKit and the independent reference client.

## Acceptance criteria

- [x] Registered events and A2UI carriage follow the profile; unknown custom and all raw production events are rejected.
- [x] Duplicate, conflicting duplicate, gap, reconnect, compaction, late tool, timeout, cancellation, and backpressure fixtures behave deterministically.
- [x] Golden streams produce equivalent visible facts, actions, deadlines, fallback, accessibility semantics, and Platform Commands in both clients.
- [x] Provisional SLOs and limits are instrumented without using sensitive data as metric labels.

## Blocked by

- [Issue 02](02-resume-an-authenticated-interaction-thread.md)
- [Issue 03](03-render-and-expire-the-first-generative-surface.md)
- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
- [Issue 17](17-transfer-an-active-matter-to-a-human.md)

## Answer

Implemented `InteractionStreamEngine` in `packages/platform-core/src/stream-replay.ts` and test suite `test/replay-observe-and-restore-streams.test.ts`.

Key architectural compliance:
- **ADR 0069 & AC1**: Enforced pinned AG-UI profile (`com.chat-marketplace.interaction/agui-v1`) and A2UI carriage (`platform.a2ui.message.v1`); rejects unknown custom and all raw production events.
- **ADR 0079 & AC2**: Deterministic handling of duplicate events (idempotent), conflicting duplicates (error), sequence gaps, reconnect restoration, stream compaction, payload size limits (64 KiB ordinary event limit).
- **ADR 0080 & AC3**: Golden stream rendering produces normalized equivalence across CopilotKit adapter and independent reference client.
- **ADR 0071, ADR 0079 & AC4**: Stream performance and SLO telemetry instrumented without using sensitive data (PII, credentials, prompts) as metric labels.

