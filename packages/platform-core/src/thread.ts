export interface SecurityContext {
  principalId: string;
  tenantId: string;
  sessionId: string;
  deviceId?: string;
  tabId?: string;
}

export interface InteractionThreadDescriptor {
  readonly threadId: string;
  readonly principalId: string;
  readonly tenantId: string;
  readonly projectionVersion: number;
}

interface ThreadAuthorityState {
  activeRunId: string | null;
  runs: Record<string, { status: string }>;
  observerStreams: Set<{
    end?: () => void;
    destroy?: () => void;
    close?: () => void;
  }>;
  observers: Set<string>;
}

function assertContext(context: SecurityContext): void {
  if (!context || !context.principalId || !context.tenantId || !context.sessionId) {
    throw new Error("Authentication required: principalId, tenantId, and sessionId are required");
  }
}

function authScopeKey(context: SecurityContext): string {
  return JSON.stringify([context.principalId, context.tenantId, context.sessionId]);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as any)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export class InteractionThreadManager {
  #threads = new Map<string, any>();
  #revokedSessions = new Set<string>();
  #invalidatedTenantScopes = new Set<string>();
  #leases = new Map<string, any>();

  #assertActiveContext(context: SecurityContext): void {
    assertContext(context);
    if (this.#revokedSessions.has(context.sessionId)) {
      throw new Error("Session is revoked");
    }
    if (this.#invalidatedTenantScopes.has(authScopeKey(context))) {
      throw new Error("Authentication context is invalidated by tenant change");
    }
  }

  createThread(context: SecurityContext) {
    this.#assertActiveContext(context);
    const threadId = `thread-${crypto.randomUUID()}`;
    const thread = {
      threadId,
      principalId: context.principalId,
      tenantId: context.tenantId,
      sessionId: context.sessionId,
      deviceId: context.deviceId,
      observers: new Set([context.tabId].filter(Boolean)),
      observerStreams: new Set(),
      runs: {} as Record<string, any>,
      activeRunId: null as string | null,
      events: [] as any[],
      lastSequence: 0,
      compactedProjection: null as any,
      projectionVersion: 1,
      streamTerminated: false
    };
    this.#threads.set(threadId, thread);
    return deepFreeze({ threadId: thread.threadId, tenantId: thread.tenantId, principalId: thread.principalId });
  }

  #requireThreadIdentity(threadId: string, context: SecurityContext) {
    this.#assertActiveContext(context);
    const thread = this.#threads.get(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }
    if (thread.principalId !== context.principalId || thread.tenantId !== context.tenantId) {
      throw new Error("Tenant scope mismatch");
    }
    return thread;
  }

  #requireThread(threadId: string, context: SecurityContext) {
    const thread = this.#requireThreadIdentity(threadId, context);
    if (thread.sessionId !== context.sessionId) {
      throw new Error("Session scope mismatch");
    }
    return thread;
  }

  #terminateThreadAuthority(thread: ThreadAuthorityState): void {
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
        // ignore
      }
    }
    thread.observerStreams.clear();
    thread.observers.clear();
  }

  getThread(threadId: string, context: SecurityContext): InteractionThreadDescriptor {
    const thread = this.#requireThread(threadId, context);
    return deepFreeze({
      threadId: thread.threadId,
      principalId: thread.principalId,
      tenantId: thread.tenantId,
      projectionVersion: thread.projectionVersion
    });
  }

  getObservers(threadId: string, context: SecurityContext) {
    const thread = this.#requireThread(threadId, context);
    if (context.tabId) {
      thread.observers.add(context.tabId);
    }
    return Array.from(thread.observers);
  }

  attachObserverStream(threadId: string, context: SecurityContext, stream: any) {
    const thread = this.#requireThread(threadId, context);
    if (stream) {
      thread.observerStreams.add(stream);
    }
    return true;
  }

  startAgentRun(threadId: string, context: SecurityContext, { intent }: { intent: string }) {
    const thread = this.#requireThread(threadId, context);
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

  completeAgentRun(threadId: string, runId: string, context: SecurityContext, result = {}) {
    const thread = this.#requireThread(threadId, context);
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

  stopAgentRun(threadId: string, runId: string, context: SecurityContext) {
    const thread = this.#requireThread(threadId, context);
    const run = thread.runs[runId];
    if (!run) throw new Error(`Run ${runId} not found`);
    run.status = "stopped";
    run.stoppedAt = new Date().toISOString();
    if (thread.activeRunId === runId) {
      thread.activeRunId = null;
    }
    return deepFreeze({ runId, status: run.status, committedActionsPreserved: true });
  }

  getActiveRun(threadId: string, context: SecurityContext) {
    const thread = this.#requireThread(threadId, context);
    if (!thread.activeRunId) return null;
    const run = thread.runs[thread.activeRunId];
    return run && run.status === "running" ? deepFreeze({ ...run }) : null;
  }

  appendEvent(threadId: string, context: SecurityContext, eventData: any) {
    const thread = this.#requireThread(threadId, context);
    const sequence = ++thread.lastSequence;
    const event = {
      sequence,
      timestamp: new Date().toISOString(),
      ...eventData
    };
    thread.events.push(event);
    return deepFreeze(event);
  }

  compactThread(threadId: string, context: SecurityContext) {
    const thread = this.#requireThread(threadId, context);
    thread.compactedProjection = {
      threadId,
      tenantId: thread.tenantId,
      principalId: thread.principalId,
      projectionVersion: thread.projectionVersion + 1,
      lastSequence: thread.lastSequence,
      facts: { summary: "Compacted interaction thread projection" }
    };
    thread.events = [];
    thread.projectionVersion += 1;
  }

  reconnect(threadId: string, context: SecurityContext, { lastSeenSequence = 0 }: { lastSeenSequence?: number } = {}) {
    const thread = this.#requireThreadIdentity(threadId, context);
    if (thread.sessionId !== context.sessionId) {
      this.#terminateThreadAuthority(thread);
      for (const lease of this.#leases.values()) {
        if (lease.threadId === thread.threadId && lease.sessionId === thread.sessionId) {
          lease.valid = false;
        }
      }
      thread.sessionId = context.sessionId;
      thread.deviceId = context.deviceId;
      thread.streamTerminated = false;
    }
    if (context.tabId) {
      thread.observers.add(context.tabId);
    }
    if (thread.compactedProjection && lastSeenSequence < thread.compactedProjection.lastSequence) {
      return deepFreeze({
        mode: "compacted-projection",
        projection: thread.compactedProjection
      });
    }
    const missedEvents = thread.events.filter((e: any) => e.sequence > lastSeenSequence);
    return deepFreeze({
      mode: "events",
      events: missedEvents
    });
  }

  issueConfirmationLease(threadId: string, context: SecurityContext, { actionType, amountKobo }: { actionType: string; amountKobo: number }) {
    const thread = this.#requireThread(threadId, context);
    const leaseId = `lease-${crypto.randomUUID()}`;
    const lease = {
      leaseId,
      threadId,
      principalId: context.principalId,
      tenantId: context.tenantId,
      sessionId: context.sessionId,
      actionType,
      amountKobo,
      currency: "NGN",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000,
      valid: true
    };
    this.#leases.set(leaseId, lease);
    return deepFreeze({ leaseId, valid: true, currency: "NGN", amountKobo });
  }

  confirmMaterialAction(leaseId: string, context: SecurityContext) {
    assertContext(context);
    const lease = this.#leases.get(leaseId);
    if (
      !lease ||
      !lease.valid ||
      lease.principalId !== context.principalId ||
      lease.tenantId !== context.tenantId ||
      lease.sessionId !== context.sessionId ||
      this.#revokedSessions.has(context.sessionId) ||
      this.#invalidatedTenantScopes.has(authScopeKey(context)) ||
      Date.now() > lease.expiresAt
    ) {
      throw new Error("Confirmation lease is invalid or revoked");
    }
    lease.valid = false;
    return deepFreeze({ confirmed: true, actionType: lease.actionType });
  }

  handleTenantChange(previousContext: SecurityContext, nextTenantId: string): void {
    assertContext(previousContext);
    if (typeof nextTenantId !== "string" || nextTenantId.length === 0) {
      throw new Error("Next tenant is required");
    }
    if (nextTenantId === previousContext.tenantId) {
      throw new Error("Tenant change requires a different tenant");
    }

    this.#invalidatedTenantScopes.add(authScopeKey(previousContext));

    for (const thread of this.#threads.values()) {
      if (
        thread.principalId === previousContext.principalId &&
        thread.tenantId === previousContext.tenantId &&
        thread.sessionId === previousContext.sessionId
      ) {
        this.#terminateThreadAuthority(thread);
        thread.streamTerminated = true;
      }
    }
    for (const lease of this.#leases.values()) {
      if (
        lease.principalId === previousContext.principalId &&
        lease.tenantId === previousContext.tenantId &&
        lease.sessionId === previousContext.sessionId
      ) {
        lease.valid = false;
      }
    }
  }

  revokeSession(sessionId: string, context?: SecurityContext) {
    if (context) {
      assertContext(context);
      if (sessionId !== context.sessionId) {
        throw new Error("Session revocation scope mismatch");
      }
    }
    this.#revokedSessions.add(sessionId);

    for (const thread of this.#threads.values()) {
      if (thread.sessionId === sessionId) {
        this.#terminateThreadAuthority(thread);
        thread.streamTerminated = true;
      }
    }
    for (const lease of this.#leases.values()) {
      if (lease.sessionId === sessionId) {
        lease.valid = false;
      }
    }
  }
}
