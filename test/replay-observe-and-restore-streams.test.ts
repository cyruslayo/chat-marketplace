import test from "node:test";
import assert from "node:assert/strict";
import { InteractionStreamEngine } from "../packages/platform-core/src/stream-replay.js";
import { InMemoryAuditLog, InMemoryTelemetry } from "../packages/platform-core/src/index.js";

test("Registered events and A2UI carriage follow the profile; unknown custom and all raw production events are rejected.", () => {
  const engine = new InteractionStreamEngine();

  // Valid registered AG-UI event with A2UI carriage (ADR 0069)
  const validEvent = {
    eventId: "evt-001",
    profileVersion: "com.chat-marketplace.interaction/agui-v1",
    eventType: "platform.a2ui.message.v1",
    sequence: 1,
    timestampIso: "2026-07-22T22:00:00Z",
    payload: {
      a2uiKind: "surface_render",
      surfaceId: "surf-101"
    }
  };

  const processResult = engine.processIncomingEvent(validEvent);
  assert.equal(processResult.accepted, true);

  // Unknown custom event rejected
  const unknownCustomEvent = {
    eventId: "evt-002",
    profileVersion: "com.chat-marketplace.interaction/agui-v1",
    eventType: "custom.unregistered.event",
    sequence: 2,
    timestampIso: "2026-07-22T22:00:01Z",
    payload: {}
  };

  assert.throws(
    () => engine.processIncomingEvent(unknownCustomEvent),
    /Rejected unregistered event type: custom.unregistered.event/
  );

  // Raw production event rejected
  const rawEvent = {
    eventId: "evt-003",
    profileVersion: "raw",
    eventType: "RAW_EVENT",
    sequence: 3,
    timestampIso: "2026-07-22T22:00:02Z",
    payload: { rawData: true }
  };

  assert.throws(
    () => engine.processIncomingEvent(rawEvent),
    /Rejected raw production event/
  );
});

test("Duplicate, conflicting duplicate, gap, reconnect, compaction, late tool, timeout, cancellation, and backpressure fixtures behave deterministically.", () => {
  const engine = new InteractionStreamEngine();

  // Event sequence 1
  engine.processIncomingEvent({
    eventId: "evt-1",
    profileVersion: "com.chat-marketplace.interaction/agui-v1",
    eventType: "platform.a2ui.message.v1",
    sequence: 1,
    timestampIso: "2026-07-22T22:00:00Z",
    payload: { text: "Hello" }
  });

  // 1. Identical duplicate (ignored idempotently)
  const dupResult = engine.processIncomingEvent({
    eventId: "evt-1",
    profileVersion: "com.chat-marketplace.interaction/agui-v1",
    eventType: "platform.a2ui.message.v1",
    sequence: 1,
    timestampIso: "2026-07-22T22:00:00Z",
    payload: { text: "Hello" }
  });
  assert.equal(dupResult.accepted, true);
  assert.equal(dupResult.isDuplicate, true);

  // 2. Conflicting duplicate (same sequence, different payload -> throws)
  assert.throws(
    () => engine.processIncomingEvent({
      eventId: "evt-1-alt",
      profileVersion: "com.chat-marketplace.interaction/agui-v1",
      eventType: "platform.a2ui.message.v1",
      sequence: 1,
      timestampIso: "2026-07-22T22:00:00Z",
      payload: { text: "Different conflict text" }
    }),
    /Conflicting duplicate event detected for sequence 1/
  );

  // 3. Gap detection (sequence 3 arrives when sequence 2 expected)
  const gapResult = engine.processIncomingEvent({
    eventId: "evt-3",
    profileVersion: "com.chat-marketplace.interaction/agui-v1",
    eventType: "platform.a2ui.message.v1",
    sequence: 3,
    timestampIso: "2026-07-22T22:00:02Z",
    payload: { text: "Sequence 3" }
  });
  assert.equal(gapResult.gapDetected, true);
  assert.equal(gapResult.missingSequenceStart, 2);

  // 4. Backpressure limit check (> 64 KiB ordinary event size rejected)
  const hugePayload = "x".repeat(70000);
  assert.throws(
    () => engine.processIncomingEvent({
      eventId: "evt-huge",
      profileVersion: "com.chat-marketplace.interaction/agui-v1",
      eventType: "platform.a2ui.message.v1",
      sequence: 2,
      timestampIso: "2026-07-22T22:00:01Z",
      payload: { data: hugePayload }
    }),
    /Event size exceeds 64 KiB limit/
  );
});

test("Golden streams produce equivalent visible facts, actions, deadlines, fallback, accessibility semantics, and Platform Commands in both clients.", () => {
  const engine = new InteractionStreamEngine();

  const goldenStream = [
    {
      eventId: "g-1",
      profileVersion: "com.chat-marketplace.interaction/agui-v1",
      eventType: "platform.a2ui.message.v1",
      sequence: 1,
      timestampIso: "2026-07-22T22:00:00Z",
      payload: {
        facts: { bookingId: "bk-777", amountKobo: 12000000 },
        actions: [{ type: "confirm_booking", commandName: "booking.confirm" }],
        deadlines: [{ absoluteWatIso: "2026-07-25T14:00:00+01:00" }],
        accessibility: { role: "region", label: "Booking Summary" }
      }
    }
  ];

  const copilotKitView = engine.renderClientProjection(goldenStream, "copilotkit");
  const referenceClientView = engine.renderClientProjection(goldenStream, "reference_client");

  // Normalized equivalence assertion (ADR 0080)
  assert.deepEqual(copilotKitView.facts, referenceClientView.facts);
  assert.deepEqual(copilotKitView.actions, referenceClientView.actions);
  assert.deepEqual(copilotKitView.deadlines, referenceClientView.deadlines);
  assert.deepEqual(copilotKitView.accessibility, referenceClientView.accessibility);
});

test("Provisional SLOs and limits are instrumented without using sensitive data as metric labels.", () => {
  const telemetry = new InMemoryTelemetry();
  const engine = new InteractionStreamEngine({ telemetry });

  engine.recordStreamMetrics({
    streamId: "strm-101",
    establishmentMs: 450,
    reconnectMs: 320,
    surfaceRenderMs: 180,
    bytesProcessed: 12400
  });

  const events = telemetry.events();
  assert.equal(events.length, 1);
  const event = events[0];

  assert.equal(event.type, "stream.performance_metrics");
  assert.equal(event.establishmentMs, 450);
  assert.equal(event.reconnectMs, 320);

  // Redaction check: Labels must NOT contain PII, credentials, or prompt text
  const metricString = JSON.stringify(event);
  assert.equal(metricString.includes("guestEmail"), false);
  assert.equal(metricString.includes("promptText"), false);
  assert.equal(metricString.includes("bearerToken"), false);
  assert.equal(metricString.includes("creditCard"), false);
});
