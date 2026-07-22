function assertContext(context) {
  if (!context || !context.principalId || !context.tenantId || !context.sessionId) {
    throw new Error("Authentication required: principalId, tenantId, and sessionId are required");
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export class InteractionThreadManager {
  #threads = new Map();
  #revokedSessions = new Set();
  #leases = new Map();

  createThread(context) {
    assertContext(context);
    const threadId = `thread-${crypto.randomUUID()}`;
    const thread = {
      threadId,
      principalId: context.principalId,
      tenantId: context.tenantId,
      sessionId: context.sessionId,
      deviceId: context.deviceId,
      observers: new Set([context.tabId].filter(Boolean)),
      observerStreams: new Set(),
      runs: {},
      activeRunId: null,
      events: [],
      compactedProjection: null,
      projectionVersion: 1,
      streamTerminated: false
    };
    this.#threads.set(threadId, thread);
    return deepFreeze({ threadId: thread.threadId, tenantId: thread.tenantId, principalId: thread.principalId });
  }

  getThread(threadId, context) {
    assertContext(context);
    if (this.#revokedSessions.has(context.sessionId)) {
      throw new Error("Session is revoked");
    }
    const thread = this.#threads.get(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }
    if (thread.principalId !== context.principalId || thread.tenantId !== context.tenantId) {
      throw new Error("Tenant scope mismatch");
    }
    return thread;
  }

  getObservers(threadId, context) {
    const thread = this.getThread(threadId, context);
    if (context.tabId) {
      thread.observers.add(context.tabId);
    }
    return Array.from(thread.observers);
  }

  attachObserverStream(threadId, context, stream) {
    const thread = this.getThread(threadId, context);
    if (stream) {
      thread.observerStreams.add(stream);
    }
    return true;
  }

  startAgentRun(threadId, context, { intent }) {
    const thread = this.getThread(threadId, context);
    if (thread.activeRunId) {
      const activeRun = thread.runs[thread.activeRunId];
      if (activeRun && activeRun.status === "running") {
        throw new Error("One mutating Agent Run allowed per thread");
      }
    }
    const runId = `run-${crypto.randomUUID()}`;
    const run = {
      runId,
      threadId,
      intent,
      tabId: context.tabId,
      status: "running",
      startedAt: new Date().toISOString()
    };
    thread.runs[runId] = run;
    thread.activeRunId = runId;
    return deepFreeze({ runId, status: run.status });
  }

  completeAgentRun(threadId, runId, context, result = {}) {
    const thread = this.getThread(threadId, context);
    const run = thread.runs[runId];
    if (!run) throw new Error(`Run ${runId} not found`);
    run.status = "completed";
    run.result = result;
    run.completedAt = new Date().toISOString();
    if (thread.activeRunId === runId) {
      thread.activeRunId = null;
    }
    return deepFreeze({ runId, status: run.status });
  }

  stopAgentRun(threadId, runId, context) {
    const thread = this.getThread(threadId, context);
    const run = thread.runs[runId];
    if (!run) throw new Error(`Run ${runId} not found`);
    run.status = "stopped";
    run.stoppedAt = new Date().toISOString();
    if (thread.activeRunId === runId) {
      thread.activeRunId = null;
    }
    return deepFreeze({ runId, status: run.status, committedActionsPreserved: true });
  }

  getActiveRun(threadId, context) {
    const thread = this.getThread(threadId, context);
    if (!thread.activeRunId) return null;
    const run = thread.runs[thread.activeRunId];
    return run && run.status === "running" ? deepFreeze({ ...run }) : null;
  }

  appendEvent(threadId, context, eventData) {
    const thread = this.getThread(threadId, context);
    const sequence = thread.events.length + 1;
    const event = {
      sequence,
      timestamp: new Date().toISOString(),
      ...eventData
    };
    thread.events.push(event);
    return deepFreeze(event);
  }

  compactThread(threadId, context) {
    const thread = this.getThread(threadId, context);
    thread.compactedProjection = {
      threadId,
      tenantId: thread.tenantId,
      principalId: thread.principalId,
      projectionVersion: thread.projectionVersion + 1,
      lastSequence: thread.events.length,
      facts: { summary: "Compacted interaction thread projection" }
    };
    thread.events = [];
    thread.projectionVersion += 1;
  }

  reconnect(threadId, context, { lastSeenSequence = 0 }) {
    const thread = this.getThread(threadId, context);
    if (context.tabId) {
      thread.observers.add(context.tabId);
    }
    if (thread.compactedProjection && lastSeenSequence < thread.compactedProjection.lastSequence) {
      return deepFreeze({
        mode: "compacted-projection",
        projection: thread.compactedProjection
      });
    }
    const missedEvents = thread.events.filter((e) => e.sequence > lastSeenSequence);
    return deepFreeze({
      mode: "events",
      events: missedEvents
    });
  }

  issueConfirmationLease(threadId, context, { actionType, amountKobo }) {
    const thread = this.getThread(threadId, context);
    const leaseId = `lease-${crypto.randomUUID()}`;
    const lease = {
      leaseId,
      threadId,
      principalId: context.principalId,
      tenantId: context.tenantId,
      sessionId: context.sessionId,
      actionType,
      amountKobo,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000,
      valid: true
    };
    this.#leases.set(leaseId, lease);
    return deepFreeze({ leaseId, valid: true });
  }

  confirmMaterialAction(leaseId, context) {
    assertContext(context);
    const lease = this.#leases.get(leaseId);
    if (
      !lease ||
      !lease.valid ||
      lease.principalId !== context.principalId ||
      lease.tenantId !== context.tenantId ||
      lease.sessionId !== context.sessionId ||
      this.#revokedSessions.has(context.sessionId) ||
      Date.now() > lease.expiresAt
    ) {
      throw new Error("Confirmation lease is invalid or revoked");
    }
    lease.valid = false;
    return deepFreeze({ confirmed: true, actionType: lease.actionType });
  }

  revokeSession(sessionId, context) {
    if (context) assertContext(context);
    this.#revokedSessions.add(sessionId);

    for (const thread of this.#threads.values()) {
      if (thread.sessionId === sessionId || (context && thread.principalId === context.principalId)) {
        if (thread.activeRunId) {
          const run = thread.runs[thread.activeRunId];
          if (run) run.status = "terminated";
          thread.activeRunId = null;
        }
        for (const stream of thread.observerStreams) {
          try {
            if (typeof stream.end === "function") stream.end();
            else if (typeof stream.destroy === "function") stream.destroy();
            else if (typeof stream.close === "function") stream.close();
          } catch {
            // ignore stream closure errors
          }
        }
        thread.observerStreams.clear();
        thread.observers.clear();
        thread.streamTerminated = true;
      }
    }
    for (const lease of this.#leases.values()) {
      if (lease.sessionId === sessionId || (context && lease.principalId === context.principalId)) {
        lease.valid = false;
      }
    }
  }
}

