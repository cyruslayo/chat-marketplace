import test from "node:test";
import assert from "node:assert/strict";
import { HumanHandoffManager, InteractionThreadManager, SecurityContext } from "../packages/platform-core/src/index.js";

function createSecurityContext(): SecurityContext {
  return {
    principalId: "guest-ada",
    tenantId: "tenant-lagos",
    sessionId: "sess-ada-1"
  };
}

test("Stop prevents future generation and tools but accurately preserves committed domain and provider actions", () => {
  const threadMgr = new InteractionThreadManager();
  const handoffMgr = new HumanHandoffManager(threadMgr);
  const context = createSecurityContext();

  const { threadId } = threadMgr.createThread(context);
  const { runId } = threadMgr.startAgentRun(threadId, context, { intent: "book_stay" });

  // Record a committed domain action
  handoffMgr.recordCommittedAction(threadId, runId, context, {
    actionId: "act-1",
    type: "payment_reserved",
    details: { amountKobo: 5000000 }
  });

  // Stop the run
  const stopped = handoffMgr.stopAgentRun(threadId, runId, context);
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.committedActionsPreserved, true);
  assert.equal(stopped.committedActions.length, 1);
  assert.equal(stopped.committedActions[0].actionId, "act-1");

  // Future tool execution or generation attempt on stopped run MUST throw
  assert.throws(
    () => handoffMgr.executeTool(threadId, runId, context, "reserve_inventory", {}),
    /Cannot execute tool: Agent Run is stopped or suspended/
  );
});

test("Mandatory triggers route to the correct staffed General Support or Active-Stay Emergency Support path", () => {
  const threadMgr = new InteractionThreadManager();
  const handoffMgr = new HumanHandoffManager(threadMgr);
  const context = createSecurityContext();
  const { threadId } = threadMgr.createThread(context);

  // General Support trigger (routine billing enquiry, non-emergency)
  const genResult = handoffMgr.initiateHandoff(threadId, context, {
    trigger: "user_request",
    category: "general_billing",
    activeStay: false
  });
  assert.equal(genResult.mode, "handoff-requested");
  assert.equal(genResult.supportPath, "general_support");
  assert.equal(genResult.targetQueue, "General Support (8 AM - 8 PM WAT)");

  // Emergency Support trigger (failed access, safety incident during active stay)
  const emergResult = handoffMgr.initiateHandoff(threadId, context, {
    trigger: "failed_access",
    category: "safety_or_access",
    activeStay: true
  });
  assert.equal(emergResult.mode, "handoff-requested");
  assert.equal(emergResult.supportPath, "active_stay_emergency_support");
  assert.equal(emergResult.targetQueue, "Active-Stay Emergency Support (24/7)");
});

test("Human ownership suppresses autonomous messages, state-changing tools, and competing scheduled nudges", () => {
  const threadMgr = new InteractionThreadManager();
  const handoffMgr = new HumanHandoffManager(threadMgr);
  const context = createSecurityContext();
  const { threadId } = threadMgr.createThread(context);

  handoffMgr.initiateHandoff(threadId, context, {
    trigger: "material_complaint",
    category: "habitability",
    activeStay: true
  });

  // Assign human responder
  handoffMgr.assignHumanOwner(threadId, context, {
    responderId: "staff-emeka",
    role: "emergency_support_responder"
  });

  const status = handoffMgr.getHandoffStatus(threadId, context);
  assert.equal(status.mode, "human-owned");
  assert.equal(status.assignedOwner, "staff-emeka");

  // Attempting autonomous agent message sending MUST throw
  assert.throws(
    () => handoffMgr.sendAutonomousMessage(threadId, context, "How is your stay going?"),
    /Autonomous messaging suppressed: Human responder owns the interaction thread/
  );

  // Attempting state-changing tool execution by agent MUST throw
  assert.throws(
    () => handoffMgr.executeTool(threadId, "any-run", context, "cancel_booking", {}),
    /State-changing tools suppressed: Human responder owns the interaction thread/
  );

  // Suppress scheduled automated nudges
  const nudgeAllowed = handoffMgr.shouldDeliverScheduledNudge(threadId, context);
  assert.equal(nudgeAllowed, false);
});

test("Handback requires authorization, resolved authority, fresh state, user notice, and a new Agent Run", () => {
  const threadMgr = new InteractionThreadManager();
  const handoffMgr = new HumanHandoffManager(threadMgr);
  const context = createSecurityContext();
  const { threadId } = threadMgr.createThread(context);

  handoffMgr.initiateHandoff(threadId, context, {
    trigger: "user_request",
    category: "general",
    activeStay: false
  });
  handoffMgr.assignHumanOwner(threadId, context, {
    responderId: "staff-emeka",
    role: "general_support_responder"
  });

  // Failure path 1: Unauthorized responder attempting handback
  assert.throws(
    () =>
      handoffMgr.handbackToAutomation(threadId, context, {
        responderId: "unauthorized-user",
        resolvedAuthority: true,
        userNotice: "Support resolved issue"
      }),
    /Unauthorized responder: Only assigned human owner can handback/
  );

  // Failure path 2: Handback without resolved authority
  assert.throws(
    () =>
      handoffMgr.handbackToAutomation(threadId, context, {
        responderId: "staff-emeka",
        resolvedAuthority: false,
        userNotice: "Trying to handback"
      }),
    /Handback requires resolved authority confirmation/
  );

  // Failure path 3: Handback without user notice
  assert.throws(
    () =>
      handoffMgr.handbackToAutomation(threadId, context, {
        responderId: "staff-emeka",
        resolvedAuthority: true,
        userNotice: ""
      }),
    /Handback requires user notice/
  );

  // Success path: Authorized handback with resolved authority, fresh state, user notice, spawning a NEW Agent Run
  const handbackResult = handoffMgr.handbackToAutomation(threadId, context, {
    responderId: "staff-emeka",
    resolvedAuthority: true,
    userNotice: "Your issue has been resolved. AI concierge is back online."
  });

  assert.equal(handbackResult.success, true);
  assert.equal(handbackResult.mode, "automated");
  assert.ok(handbackResult.newRunId.startsWith("run-"));
  assert.equal(handbackResult.freshProjection.version > 1, true);

  const statusAfter = handoffMgr.getHandoffStatus(threadId, context);
  assert.equal(statusAfter.mode, "automated");
  assert.equal(statusAfter.assignedOwner, null);
});
