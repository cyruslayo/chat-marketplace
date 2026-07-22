import test from "node:test";
import assert from "node:assert/strict";
import { InteractionThreadManager } from "../packages/platform-core/src/index.js";

function setup() {
  const manager = new InteractionThreadManager();
  const context = {
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

  // Attempt operation with wrong tenant
  const wrongTenantContext = { ...context, tenantId: "tenant-other" };
  assert.throws(
    () => manager.getThread(thread.threadId, wrongTenantContext),
    /Tenant scope mismatch/
  );

  // Attempt operation without authentication context
  assert.throws(
    () => manager.getThread(thread.threadId, null),
    /Authentication required/
  );
});

test("allows only one mutating Agent Run per thread while multiple tabs observe", () => {
  const { manager, context } = setup();
  const thread = manager.createThread(context);

  // Tab 1 starts a mutating run
  const run1 = manager.startAgentRun(thread.threadId, context, { intent: "search-stay" });
  assert.equal(run1.status, "running");

  // Tab 2 attaches to observe
  const tab2Context = { ...context, tabId: "tab-2" };
  const observers = manager.getObservers(thread.threadId, tab2Context);
  assert.ok(observers.includes("tab-2"));

  // Tab 2 tries to start another mutating run while run1 is active -> fails
  assert.throws(
    () => manager.startAgentRun(thread.threadId, tab2Context, { intent: "book-stay" }),
    /mutating Agent Run/
  );

  // Complete run1
  manager.completeAgentRun(thread.threadId, run1.runId, context, { result: "ok" });

  // Now Tab 2 can start a new run
  const run2 = manager.startAgentRun(thread.threadId, tab2Context, { intent: "book-stay" });
  assert.equal(run2.status, "running");
});

test("reconnect resumes by sequence or returns compacted projection without starting new run", () => {
  const { manager, context } = setup();
  const thread = manager.createThread(context);

  manager.appendEvent(thread.threadId, context, { type: "message", content: "Hello" }); // seq 1
  manager.appendEvent(thread.threadId, context, { type: "message", content: "World" }); // seq 2

  // Reconnect with lastSeenSequence = 1 -> returns sequence 2
  const resumed = manager.reconnect(thread.threadId, context, { lastSeenSequence: 1 });
  assert.equal(resumed.mode, "events");
  assert.equal(resumed.events.length, 1);
  assert.equal(resumed.events[0].sequence, 2);

  // Compact thread
  manager.compactThread(thread.threadId, context);

  // Reconnect with old sequence after compaction -> returns compacted projection snapshot
  const projection = manager.reconnect(thread.threadId, context, { lastSeenSequence: 1 });
  assert.equal(projection.mode, "compacted-projection");
  assert.ok(projection.projection);
  assert.equal(projection.projection.threadId, thread.threadId);
  // Ensure no new run was started
  const activeRun = manager.getActiveRun(thread.threadId, context);
  assert.equal(activeRun, null);
});

test("logout, revocation, or tenant change terminates streams and invalidates confirmation authority", () => {
  const { manager, context } = setup();
  const thread = manager.createThread(context);

  // Issue a material confirmation lease
  const lease = manager.issueConfirmationLease(thread.threadId, context, {
    actionType: "confirm-booking",
    amountKobo: 5000000
  });
  assert.equal(lease.valid, true);

  // Start an active run
  const run = manager.startAgentRun(thread.threadId, context, { intent: "confirm" });
  assert.equal(run.status, "running");

  // User logs out / session is revoked
  manager.revokeSession(context.sessionId, context);

  // Thread access with revoked session must be rejected
  assert.throws(
    () => manager.getThread(thread.threadId, context),
    /Session is revoked/
  );

  // Confirmation lease must be invalidated
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
