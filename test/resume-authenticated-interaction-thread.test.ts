import test from "node:test";
import assert from "node:assert/strict";
import { InteractionThreadManager, SecurityContext } from "../packages/platform-core/src/index.js";

function setup() {
  const manager = new InteractionThreadManager();
  const context: SecurityContext = {
    principalId: "user-123",
    tenantId: "tenant-lagos",
    sessionId: "sess-abc",
    deviceId: "dev-xyz",
    tabId: "tab-1"
  };
  return { manager, context };
}

test("authentication and tenant scope are enforced on all thread operations", () => {
  const { manager, context } = setup();
  const thread = manager.createThread(context);
  assert.ok(thread.threadId);
  assert.equal(thread.tenantId, "tenant-lagos");

  const wrongTenantContext = { ...context, tenantId: "tenant-other" };
  assert.throws(
    () => manager.getThread(thread.threadId, wrongTenantContext),
    /Tenant scope mismatch/
  );

  assert.throws(
    () => manager.getThread(thread.threadId, null as any),
    /Authentication required/
  );
});

test("public thread lookup exposes only frozen read-only thread metadata", () => {
  const { manager, context } = setup();
  const thread = manager.createThread(context);

  const descriptor = manager.getThread(thread.threadId, context);
  assert.deepEqual(Object.keys(descriptor).sort(), ["principalId", "projectionVersion", "tenantId", "threadId"]);
  assert.equal(descriptor.threadId, thread.threadId);
  assert.equal(descriptor.principalId, context.principalId);
  assert.equal(descriptor.tenantId, context.tenantId);
  assert.equal(descriptor.projectionVersion, 1);
  assert.equal(Object.isFrozen(descriptor), true);

  for (const field of [
    "sessionId",
    "deviceId",
    "activeRunId",
    "runs",
    "events",
    "observers",
    "observerStreams",
    "lastSequence",
    "compactedProjection",
    "streamTerminated"
  ]) {
    assert.equal(field in descriptor, false, `${field} must not be exposed`);
  }

  const firstRun = manager.startAgentRun(thread.threadId, context, { intent: "search-stay" });
  const runningDescriptor = manager.getThread(thread.threadId, context);
  assert.equal(Reflect.set(runningDescriptor, "projectionVersion", 99), false);
  assert.equal(runningDescriptor.projectionVersion, 1);

  const otherTabContext = { ...context, tabId: "tab-2" };
  assert.throws(
    () => manager.startAgentRun(thread.threadId, otherTabContext, { intent: "book-stay" }),
    /mutating Agent Run/
  );

  manager.completeAgentRun(thread.threadId, firstRun.runId, context);
  manager.compactThread(thread.threadId, context);
  assert.equal(manager.getThread(thread.threadId, context).projectionVersion, 2);

  const wrongTenantContext = { ...context, tenantId: "tenant-other" };
  assert.throws(
    () => manager.getThread(thread.threadId, wrongTenantContext),
    /Tenant scope mismatch/
  );
});

test("allows only one mutating Agent Run per thread while multiple tabs observe", () => {
  const { manager, context } = setup();
  const thread = manager.createThread(context);

  const run1 = manager.startAgentRun(thread.threadId, context, { intent: "search-stay" });
  assert.equal(run1.status, "running");

  const tab2Context = { ...context, tabId: "tab-2" };
  const observers = manager.getObservers(thread.threadId, tab2Context);
  assert.ok(observers.includes("tab-2"));

  assert.throws(
    () => manager.startAgentRun(thread.threadId, tab2Context, { intent: "book-stay" }),
    /mutating Agent Run/
  );

  manager.completeAgentRun(thread.threadId, run1.runId, context, { result: "ok" });

  const run2 = manager.startAgentRun(thread.threadId, tab2Context, { intent: "book-stay" });
  assert.equal(run2.status, "running");
});

test("reconnect resumes by sequence or returns compacted projection without starting new run", () => {
  const { manager, context } = setup();
  const thread = manager.createThread(context);

  manager.appendEvent(thread.threadId, context, { type: "message", content: "Hello" });
  manager.appendEvent(thread.threadId, context, { type: "message", content: "World" });

  const resumed: any = manager.reconnect(thread.threadId, context, { lastSeenSequence: 1 });
  assert.equal(resumed.mode, "events");
  assert.equal(resumed.events.length, 1);
  assert.equal(resumed.events[0].sequence, 2);

  manager.compactThread(thread.threadId, context);

  const projection: any = manager.reconnect(thread.threadId, context, { lastSeenSequence: 1 });
  assert.equal(projection.mode, "compacted-projection");
  assert.ok(projection.projection);
  assert.equal(projection.projection.threadId, thread.threadId);

  const activeRun = manager.getActiveRun(thread.threadId, context);
  assert.equal(activeRun, null);
});

test("event sequences remain monotonic across compaction and reconnect", () => {
  const { manager, context } = setup();
  const thread = manager.createThread(context);

  const firstEvent = manager.appendEvent(thread.threadId, context, { type: "message", content: "First" });
  const secondEvent = manager.appendEvent(thread.threadId, context, { type: "message", content: "Second" });
  assert.equal(firstEvent.sequence, 1);
  assert.equal(secondEvent.sequence, 2);

  manager.compactThread(thread.threadId, context);

  const thirdEvent = manager.appendEvent(thread.threadId, context, { type: "message", content: "Third" });
  assert.equal(thirdEvent.sequence, 3);

  const afterFirstCompaction: any = manager.reconnect(thread.threadId, context, { lastSeenSequence: 2 });
  assert.equal(afterFirstCompaction.mode, "events");
  assert.equal(afterFirstCompaction.events.length, 1);
  assert.equal(afterFirstCompaction.events[0].sequence, 3);
  assert.equal(manager.getActiveRun(thread.threadId, context), null);

  manager.compactThread(thread.threadId, context);

  const fourthEvent = manager.appendEvent(thread.threadId, context, { type: "message", content: "Fourth" });
  assert.equal(fourthEvent.sequence, 4);

  const afterSecondCompaction: any = manager.reconnect(thread.threadId, context, { lastSeenSequence: 3 });
  assert.equal(afterSecondCompaction.mode, "events");
  assert.equal(afterSecondCompaction.events.length, 1);
  assert.equal(afterSecondCompaction.events[0].sequence, 4);
  assert.equal(manager.getActiveRun(thread.threadId, context), null);
});

test("logout, revocation, or tenant change terminates streams and invalidates confirmation authority", () => {
  const { manager, context } = setup();
  const thread = manager.createThread(context);

  let streamEnded = false;
  const mockStream = { end() { streamEnded = true; } };
  manager.attachObserverStream(thread.threadId, context, mockStream);

  const lease = manager.issueConfirmationLease(thread.threadId, context, {
    actionType: "confirm-booking",
    amountKobo: 5000000
  });
  assert.equal(lease.valid, true);

  const run = manager.startAgentRun(thread.threadId, context, { intent: "confirm" });
  assert.equal(run.status, "running");

  manager.revokeSession(context.sessionId, context);

  assert.equal(streamEnded, true);

  assert.throws(
    () => manager.getThread(thread.threadId, context),
    /Session is revoked/
  );

  assert.throws(
    () => manager.confirmMaterialAction(lease.leaseId, context),
    /invalid or revoked/i
  );
});

test("stopping an agent run does not undo committed domain actions", () => {
  const { manager, context } = setup();
  const thread = manager.createThread(context);
  const run = manager.startAgentRun(thread.threadId, context, { intent: "hold-unit" });

  const stopped = manager.stopAgentRun(thread.threadId, run.runId, context);
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.committedActionsPreserved, true);
});

test("session revocation is exact-scoped and cannot revoke another session", () => {
  const manager = new InteractionThreadManager();
  const contextA: SecurityContext = {
    principalId: "user-123",
    tenantId: "tenant-lagos",
    sessionId: "sess-a",
    tabId: "tab-a"
  };
  const contextB: SecurityContext = {
    principalId: "user-123",
    tenantId: "tenant-lagos",
    sessionId: "sess-b",
    tabId: "tab-b"
  };
  const threadA = manager.createThread(contextA);
  const threadB = manager.createThread(contextB);
  let streamAEnded = false;
  let streamBEnded = false;

  manager.attachObserverStream(threadA.threadId, contextA, { end() { streamAEnded = true; } });
  manager.attachObserverStream(threadB.threadId, contextB, { end() { streamBEnded = true; } });
  const leaseA = manager.issueConfirmationLease(threadA.threadId, contextA, {
    actionType: "confirm-booking",
    amountKobo: 5000000
  });
  const leaseB = manager.issueConfirmationLease(threadB.threadId, contextB, {
    actionType: "confirm-booking",
    amountKobo: 6000000
  });
  const runA = manager.startAgentRun(threadA.threadId, contextA, { intent: "confirm-a" });
  const runB = manager.startAgentRun(threadB.threadId, contextB, { intent: "confirm-b" });

  assert.throws(
    () => manager.revokeSession(contextB.sessionId, contextA),
    /session revocation scope mismatch/i
  );
  assert.equal(streamAEnded, false);
  assert.equal(streamBEnded, false);
  assert.equal(manager.getThread(threadA.threadId, contextA).threadId, threadA.threadId);
  assert.equal(manager.getThread(threadB.threadId, contextB).threadId, threadB.threadId);
  assert.equal(manager.getActiveRun(threadA.threadId, contextA)?.runId, runA.runId);
  assert.equal(manager.getActiveRun(threadB.threadId, contextB)?.runId, runB.runId);

  manager.revokeSession(contextA.sessionId, contextA);
  assert.equal(streamAEnded, true);
  assert.throws(() => manager.getThread(threadA.threadId, contextA), /Session is revoked/);
  assert.throws(() => manager.confirmMaterialAction(leaseA.leaseId, contextA), /invalid or revoked/i);
  assert.throws(() => manager.getActiveRun(threadA.threadId, contextA), /Session is revoked/);

  assert.equal(streamBEnded, false);
  assert.equal(manager.getThread(threadB.threadId, contextB).threadId, threadB.threadId);
  assert.equal(manager.getActiveRun(threadB.threadId, contextB)?.runId, runB.runId);
  assert.equal(manager.confirmMaterialAction(leaseB.leaseId, contextB).confirmed, true);

  const leaseB2 = manager.issueConfirmationLease(threadB.threadId, contextB, {
    actionType: "confirm-booking",
    amountKobo: 6000000
  });
  manager.revokeSession(contextB.sessionId);
  assert.equal(streamBEnded, true);
  assert.throws(() => manager.getThread(threadB.threadId, contextB), /Session is revoked/);
  assert.throws(() => manager.confirmMaterialAction(leaseB2.leaseId, contextB), /invalid or revoked/i);
  manager.revokeSession(contextB.sessionId);
});
