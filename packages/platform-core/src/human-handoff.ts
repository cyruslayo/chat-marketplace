import { InteractionThreadManager, SecurityContext } from "./thread.js";

/**
 * ADR 0076 & ADR 0030 & ADR 0067:
 * Control modes for human transfer and takeover.
 */
export type InteractionControlMode = "automated" | "handoff-requested" | "human-owned" | "resume-pending";

export type SupportPath = "general_support" | "active_stay_emergency_support";

export interface CommittedAction {
  actionId: string;
  type: string;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface HandoffState {
  threadId: string;
  mode: InteractionControlMode;
  supportPath?: SupportPath;
  targetQueue?: string;
  assignedOwner?: string | null;
  committedActions: CommittedAction[];
  contextPacket?: {
    summary: string;
    minimizedData: Record<string, unknown>;
  };
}

export class HumanHandoffManager {
  readonly #threadManager: InteractionThreadManager;
  readonly #handoffStates = new Map<string, HandoffState>();

  constructor(threadManager: InteractionThreadManager) {
    this.#threadManager = threadManager;
  }

  #getOrCreateHandoffState(threadId: string): HandoffState {
    let state = this.#handoffStates.get(threadId);
    if (!state) {
      state = {
        threadId,
        mode: "automated",
        assignedOwner: null,
        committedActions: []
      };
      this.#handoffStates.set(threadId, state);
    }
    return state;
  }

  recordCommittedAction(
    threadId: string,
    runId: string,
    context: SecurityContext,
    action: { actionId: string; type: string; details: Record<string, unknown> }
  ): void {
    this.#threadManager.getThread(threadId, context);
    const state = this.#getOrCreateHandoffState(threadId);
    state.committedActions.push({
      ...action,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * ADR 0076: Stop prevents future generation and tools but accurately preserves committed domain actions.
   */
  stopAgentRun(
    threadId: string,
    runId: string,
    context: SecurityContext
  ): {
    status: string;
    committedActionsPreserved: boolean;
    committedActions: CommittedAction[];
  } {
    const stopResult = this.#threadManager.stopAgentRun(threadId, runId, context);
    const state = this.#getOrCreateHandoffState(threadId);
    return {
      status: stopResult.status,
      committedActionsPreserved: true,
      committedActions: [...state.committedActions]
    };
  }

  /**
   * ADR 0030 & ADR 0067: Initiate handoff based on trigger and active stay status.
   */
  initiateHandoff(
    threadId: string,
    context: SecurityContext,
    options: {
      trigger: string;
      category: string;
      activeStay: boolean;
    }
  ): HandoffState {
    this.#threadManager.getThread(threadId, context);
    const state = this.#getOrCreateHandoffState(threadId);
    state.mode = "handoff-requested";

    if (options.activeStay || options.category === "safety_or_access") {
      state.supportPath = "active_stay_emergency_support";
      state.targetQueue = "Active-Stay Emergency Support (24/7)";
    } else {
      state.supportPath = "general_support";
      state.targetQueue = "General Support (8 AM - 8 PM WAT)";
    }

    state.contextPacket = {
      summary: `Handoff requested for ${options.category} via ${options.trigger}`,
      minimizedData: {
        trigger: options.trigger,
        category: options.category,
        activeStay: options.activeStay
      }
    };

    return { ...state };
  }

  /**
   * ADR 0076: Human ownership assignment.
   */
  assignHumanOwner(
    threadId: string,
    context: SecurityContext,
    owner: { responderId: string; role: string }
  ): HandoffState {
    this.#threadManager.getThread(threadId, context);
    const state = this.#getOrCreateHandoffState(threadId);
    state.mode = "human-owned";
    state.assignedOwner = owner.responderId;
    return { ...state };
  }

  getHandoffStatus(threadId: string, context: SecurityContext): HandoffState {
    this.#threadManager.getThread(threadId, context);
    return { ...this.#getOrCreateHandoffState(threadId) };
  }

  /**
   * ADR 0076: Autonomous messaging suppressed during human ownership.
   */
  sendAutonomousMessage(threadId: string, context: SecurityContext, message: string): void {
    this.#threadManager.getThread(threadId, context);
    const state = this.#getOrCreateHandoffState(threadId);
    if (state.mode === "human-owned" || state.mode === "handoff-requested") {
      throw new Error("Autonomous messaging suppressed: Human responder owns the interaction thread");
    }
  }

  /**
   * ADR 0076: State-changing tools suppressed during human ownership or stopped run.
   */
  executeTool(
    threadId: string,
    runId: string,
    context: SecurityContext,
    toolName: string,
    args: Record<string, unknown>
  ): void {
    this.#threadManager.getThread(threadId, context);
    const state = this.#getOrCreateHandoffState(threadId);
    if (state.mode === "human-owned" || state.mode === "handoff-requested") {
      throw new Error("State-changing tools suppressed: Human responder owns the interaction thread");
    }

    const activeRun = this.#threadManager.getActiveRun(threadId, context);
    if (!activeRun || activeRun.status !== "running") {
      throw new Error("Cannot execute tool: Agent Run is stopped or suspended");
    }
  }

  /**
   * ADR 0076: Suppress competing scheduled nudges when human owns thread.
   */
  shouldDeliverScheduledNudge(threadId: string, context: SecurityContext): boolean {
    this.#threadManager.getThread(threadId, context);
    const state = this.#getOrCreateHandoffState(threadId);
    return state.mode === "automated";
  }

  /**
   * ADR 0076: Handback requires authorization, resolved authority, fresh state, user notice, and a new Agent Run.
   */
  handbackToAutomation(
    threadId: string,
    context: SecurityContext,
    options: {
      responderId: string;
      resolvedAuthority: boolean;
      userNotice: string;
    }
  ): {
    success: boolean;
    mode: InteractionControlMode;
    newRunId: string;
    freshProjection: { version: number };
  } {
    this.#threadManager.getThread(threadId, context);
    const state = this.#getOrCreateHandoffState(threadId);

    if (state.assignedOwner && options.responderId !== state.assignedOwner) {
      throw new Error("Unauthorized responder: Only assigned human owner can handback");
    }

    if (!options.resolvedAuthority) {
      throw new Error("Handback requires resolved authority confirmation");
    }

    if (!options.userNotice || options.userNotice.trim() === "") {
      throw new Error("Handback requires user notice");
    }

    // Update state
    state.mode = "automated";
    state.assignedOwner = null;

    // Compact/refresh projection on thread
    this.#threadManager.compactThread(threadId, context);

    // Start a new agent run
    const newRun = this.#threadManager.startAgentRun(threadId, context, {
      intent: "handback_resumed_concierge"
    });

    const updatedThread = this.#threadManager.getThread(threadId, context);

    return {
      success: true,
      mode: "automated",
      newRunId: newRun.runId,
      freshProjection: { version: updatedThread.projectionVersion }
    };
  }
}
