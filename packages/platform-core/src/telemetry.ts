/** Redacted, observational telemetry for authoritative application transitions. */
export interface TransitionTelemetryEvent {
  readonly type: string;
  readonly eventVersion: "1";
  readonly timestamp: string;
  readonly tenantId?: string;
  readonly principalId?: string;
  readonly threadId?: string;
  readonly runId?: string;
  readonly surfaceId?: string;
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  readonly previousState?: string;
  readonly nextState?: string;
  readonly reasonCode?: string;
  readonly correlationId?: string;
  readonly durationMs?: number;
  readonly transitionKey: string;
}

export type TelemetryEvent = Readonly<Record<string, unknown>>;
