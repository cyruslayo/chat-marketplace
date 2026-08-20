import test from "node:test";
import assert from "node:assert/strict";
import {
  INTERACTION_STREAM_VERSION,
  InteractionStreamEngine,
  StreamEvent
} from "../packages/platform-core/src/stream-replay.js";
import { InMemoryTelemetry } from "../packages/platform-core/src/index.js";

function event(sequence: number, overrides: Partial<StreamEvent> = {}): StreamEvent {
  return {
    eventId: `evt-${sequence}`,
    streamVersion: INTERACTION_STREAM_VERSION,
    eventType: "platform.a2ui.message.v1",
    sequence,
    timestampIso: `2026-07-22T22:00:${String(sequence).padStart(2, "0")}Z`,
    payload: { text: `Sequence ${sequence}` },
    ...overrides
  };
}

test("AC1: Registered stream contract accepts registered A2UI carriage", () => {
  const engine = new InteractionStreamEngine();

  assert.equal(engine.processIncomingEvent(event(1)).accepted, true);
});

test("AC2: Wrong stream version fails closed with framework-neutral rejection", () => {
  const engine = new InteractionStreamEngine();

  assert.throws(
    () => engine.processIncomingEvent(event(1, { streamVersion: "com.chat-marketplace.interaction/unknown-v99" })),
    /Rejected unregistered stream version: com\.chat-marketplace\.interaction\/unknown-v99/
  );
});

test("AC3: Raw events still fail closed", () => {
  const rawVersionEngine = new InteractionStreamEngine();
  assert.throws(
    () => rawVersionEngine.processIncomingEvent(event(1, { streamVersion: "raw" })),
    /Rejected raw production event/
  );

  const rawTypeEngine = new InteractionStreamEngine();
  assert.throws(
    () => rawTypeEngine.processIncomingEvent(event(1, { eventType: "RAW_EVENT" })),
    /Rejected raw production event/
  );
});

test("AC4: Unknown event type still fails closed", () => {
  const engine = new InteractionStreamEngine();

  assert.throws(
    () => engine.processIncomingEvent(event(1, { eventType: "custom.unregistered.event" })),
    /Rejected unregistered event type: custom\.unregistered\.event/
  );
});

test("AC5: Duplicate semantics preserve idempotent acceptance and conflicting rejection", () => {
  const engine = new InteractionStreamEngine();
  const first = event(1);
  engine.processIncomingEvent(first);

  const duplicate = engine.processIncomingEvent({ ...first });
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.isDuplicate, true);

  assert.throws(
    () => engine.processIncomingEvent(event(1, { eventId: "evt-1-conflict", payload: { text: "Different" } })),
    /Conflicting duplicate event detected for sequence 1/
  );
});

test("AC6: Gap detection reports the missing sequence start", () => {
  const engine = new InteractionStreamEngine();
  engine.processIncomingEvent(event(1));

  const result = engine.processIncomingEvent(event(3));
  assert.equal(result.gapDetected, true);
  assert.equal(result.missingSequenceStart, 2);
});

test("AC7: Size protection rejects payloads over 64 KiB", () => {
  const engine = new InteractionStreamEngine();

  assert.throws(
    () => engine.processIncomingEvent(event(1, { payload: { data: "x".repeat(70000) } })),
    /Event size exceeds 64 KiB limit/
  );
});

test("AC8: Reconnect returns only newer events in sequence order", () => {
  const engine = new InteractionStreamEngine();
  engine.processIncomingEvent(event(1));
  engine.processIncomingEvent(event(2));
  engine.processIncomingEvent(event(3));

  const result = engine.reconnect({ lastSeenSequence: 1 });
  assert.equal(result.mode, "events");
  assert.deepEqual(result.events.map((item) => item.sequence), [2, 3]);
});

test("AC9: Compaction captures the highest sequence and reconnect returns compacted-snapshot mode", () => {
  const engine = new InteractionStreamEngine();
  engine.processIncomingEvent(event(1));
  engine.processIncomingEvent(event(2));
  engine.processIncomingEvent(event(3));

  const snapshot = engine.compactStream();
  assert.equal(snapshot.lastSequence, 3);

  const result = engine.reconnect({ lastSeenSequence: 1 });
  assert.equal(result.mode, "compacted-snapshot");
  assert.equal(result.snapshot.lastSequence, 3);
});

test("AC10: Framework-neutral projection normalizes facts, actions, deadlines, and accessibility", () => {
  const engine = new InteractionStreamEngine();
  const projection = engine.renderInteractionProjection([
    event(1, {
      payload: {
        facts: { bookingId: "bk-777" },
        actions: [{ type: "confirm_booking" }],
        deadlines: [{ absoluteWatIso: "2026-07-25T14:00:00+01:00" }],
        accessibility: { role: "region" }
      }
    })
  ]);

  assert.deepEqual(projection.facts, { bookingId: "bk-777" });
  assert.deepEqual(projection.actions, [{ type: "confirm_booking" }]);
  assert.deepEqual(projection.deadlines, [{ absoluteWatIso: "2026-07-25T14:00:00+01:00" }]);
  assert.deepEqual(projection.accessibility, { role: "region" });
  assert.equal("clientType" in projection, false);
});

test("AC11: Projection is deterministic for equivalent immutable stream input", () => {
  const engine = new InteractionStreamEngine();
  const stream = [event(1, { payload: { facts: { bookingId: "bk-777" } } })];

  assert.deepEqual(engine.renderInteractionProjection(stream), engine.renderInteractionProjection(stream));
});

test("AC12: Telemetry remains redacted", () => {
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
  assert.equal(events[0].streamId, "strm-101");
  assert.equal(events[0].establishmentMs, 450);
  assert.equal(events[0].reconnectMs, 320);
  assert.equal(events[0].surfaceRenderMs, 180);
  assert.equal(events[0].bytesProcessed, 12400);

  const metricString = JSON.stringify(events[0]);
  assert.equal(metricString.includes("guestEmail"), false);
  assert.equal(metricString.includes("promptText"), false);
  assert.equal(metricString.includes("bearerToken"), false);
  assert.equal(metricString.includes("creditCard"), false);
});

test("AC13: stream-replay source has no AG-UI or client-specific replay coupling", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../packages/platform-core/src/stream-replay.ts", import.meta.url), "utf8");

  const legacyTerms = [
    ["com.chat-marketplace.interaction", "agui-v1"].join("/"),
    ["copilot", "kit"].join(""),
    ["reference", "_", "client"].join(""),
    ["Client", "Projection"].join(""),
    ["render", ["Client", "Projection"].join("")].join("")
  ];
  for (const legacyTerm of legacyTerms) {
    assert.equal(source.includes(legacyTerm), false, legacyTerm);
  }
  assert.equal(source.includes("platform.a2ui.message.v1"), true);
});
