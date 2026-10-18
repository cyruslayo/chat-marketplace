import type { CommandPrincipal, PlatformCommandEnvelope } from "./envelope.js";
import { createPlatformCommandEnvelope } from "./envelope.js";

/**
 * The one platform action gate (ADR 0099 rule 3, ADR 0072). Every consequential action —
 * an agent tool call and the deterministic concierge path alike — is resolved here, so a
 * domain pack declares *what* its action is and never re-implements the gate.
 *
 * The gate performs, in order: action lookup (G1), context shape and allow-list (G2–G4),
 * authoritative artifact load (G5), artifact kind and schema version (G6), artifact/entity
 * match (G7–G8), stale projection (G9), advertised-action authorization (G10), then one
 * platform command envelope (G13). Stale or invalid surfaces fail closed (ADR 0074).
 */

export type ActionRejectionCode =
  | "UNSUPPORTED_ACTION"
  | "INVALID_CONTEXT"
  | "INVALID_ARTIFACT"
  | "ARTIFACT_MISMATCH"
  | "STALE_ACTION"
  | "ACTION_NOT_AUTHORIZED"
  | "INVALID_ROUTE"
  | `${string}_MISMATCH`;

export interface ActionRejection {
  readonly code: ActionRejectionCode;
  readonly message: string;
}

export type ActionOutcome<Artifact> =
  | { readonly ok: true; readonly artifact: Artifact }
  | { readonly ok: false; readonly code: ActionRejectionCode; readonly message: string };

/** The minimal structural view of an inbound action event the gate needs (ADR 0072). */
export interface ActionServerEvent {
  readonly message?: {
    readonly action?: {
      readonly name?: string;
      readonly context?: unknown;
    };
  };
}

/** The minimal structural view of an authoritative artifact the gate validates against. */
export interface ActionArtifact {
  readonly id: string;
  readonly kind: string;
  readonly schemaVersion?: string;
  readonly projectionVersion: number | string;
}

export interface ActionContextField {
  readonly type: "string" | "integer" | "number" | "boolean" | "string-or-number";
  readonly nonEmpty?: boolean;
  readonly enum?: readonly string[];
  /** For strings: the value must match this regular expression source. */
  readonly pattern?: string;
  /** For numbers/integers: the value must be at least this. */
  readonly min?: number;
}

export interface ActionContextSchema {
  readonly required: Readonly<Record<string, ActionContextField>>;
  readonly optional?: Readonly<Record<string, ActionContextField>>;
}

export interface ActionRunInput<Context, Artifact, Payload> {
  readonly context: Context;
  readonly artifact: Artifact;
  readonly principal: CommandPrincipal;
  /** Present only when the spec declares a `command`; otherwise the domain runs its own command path. */
  readonly envelope?: PlatformCommandEnvelope<Payload>;
}

/** G9: one expected value the context asserts must equal the artifact's current value. */
export interface ActionExpectation<Context, Artifact> {
  readonly expected: (context: Context) => unknown;
  readonly actual: (artifact: Artifact) => unknown;
}

/**
 * A pack's declaration of one consequential action. The gate does G1–G13 generically; the
 * pack supplies only the action-specific parts (which artifact, its identity, the entity
 * match, the expected versions, authorization, the command descriptor and the domain run).
 */
export interface ActionSpec<Context, Artifact extends ActionArtifact, Payload = unknown> {
  readonly name: string;
  readonly artifact: {
    /** G6: when set, the artifact kind must match. */
    readonly kind?: string;
    /** G6: when set, the artifact schema version must match. */
    readonly schemaVersion?: string;
    readonly load: (context: Context, principal: CommandPrincipal) => Artifact;
    /** G6: extra artifact validation (for example a derived id or integer projection). */
    readonly validate?: (artifact: Artifact) => boolean;
    /** The rejection when `load` throws; defaults to INVALID_ARTIFACT. */
    readonly loadRejected?: ActionRejection;
    /** Maps a thrown load error to a rejection code (with `loadRejected`'s message); defaults to `loadRejected.code`. */
    readonly loadRejectedCode?: (error: unknown) => ActionRejectionCode;
  };
  readonly context: ActionContextSchema;
  /** G7–G8: returns a rejection when the context does not name the authoritative artifact/entity. */
  readonly crossMatch?: (context: Context, artifact: Artifact) => ActionRejection | true;
  /** G9: the versions the context must still match; the gate compares them to the artifact. */
  readonly expect: readonly ActionExpectation<Context, Artifact>[];
  /** G10: returns true when the artifact advertises this action to the principal. */
  readonly isAuthorized: (context: Context, artifact: Artifact, principal: CommandPrincipal) => boolean;
  /** The rejection when `isAuthorized` is false; defaults to ACTION_NOT_AUTHORIZED. */
  readonly authorizationRejected?: ActionRejection;
  /** G13: the platform command the gate will envelope and hand to `run`. Omit when the domain method owns command creation. */
  readonly command?: (context: Context, artifact: Artifact) => {
    readonly commandName: string;
    readonly payload: Payload;
    readonly idempotencyKey?: string;
    readonly expectedVersion?: number | string;
  };
  /** G13: the domain run, executed with the gate-built envelope; returns the refreshed projection. */
  readonly run: (input: ActionRunInput<Context, Artifact, Payload>) => Artifact | Promise<Artifact>;
  readonly rejectionMessages: {
    readonly stale: string;
    readonly runRejected: string;
  };
  /** G13: maps a thrown run error to a rejection code; defaults to ACTION_NOT_AUTHORIZED. */
  readonly runRejectedCode?: (error: unknown) => ActionRejectionCode;
}

type GateResolution<Context, Artifact extends ActionArtifact, Payload> =
  | { readonly kind: "rejected"; readonly code: ActionRejectionCode; readonly message: string }
  | {
      readonly kind: "ready";
      readonly spec: ActionSpec<Context, Artifact, Payload>;
      readonly input: ActionRunInput<Context, Artifact, Payload>;
    };

function reject<Artifact>(code: ActionRejectionCode, message: string): ActionOutcome<Artifact> {
  return { ok: false, code, message };
}

function matchesField(value: unknown, field: ActionContextField): boolean {
  if (field.type === "string") {
    if (typeof value !== "string") return false;
    if (field.nonEmpty && value.length === 0) return false;
    if (field.enum && !field.enum.includes(value)) return false;
    if (field.pattern && !new RegExp(field.pattern).test(value)) return false;
    return true;
  }
  if (field.type === "integer") return typeof value === "number" && Number.isInteger(value) && (field.min === undefined || value >= field.min);
  if (field.type === "number") return typeof value === "number" && (field.min === undefined || value >= field.min);
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "string-or-number") return typeof value === "string" || typeof value === "number";
  return false;
}

/** G2–G4: exact key set, required fields present and typed, optional fields typed when set. */
function parseContext<Context>(schema: ActionContextSchema, raw: unknown): Context | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const optional = schema.optional ?? {};
  const allowed = new Set([...Object.keys(schema.required), ...Object.keys(optional)]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return undefined;
  }
  for (const [key, field] of Object.entries(schema.required)) {
    if (!(key in record) || !matchesField(record[key], field)) return undefined;
  }
  for (const [key, field] of Object.entries(optional)) {
    if (record[key] !== undefined && !matchesField(record[key], field)) return undefined;
  }
  return record as unknown as Context;
}

/** G9: the action is stale when any asserted expectation no longer equals the artifact. */
function detectStale<Context, Artifact>(
  expectations: readonly ActionExpectation<Context, Artifact>[],
  context: Context,
  artifact: Artifact,
): boolean {
  return expectations.some(({ expected, actual }) => {
    const want = expected(context);
    return want !== undefined && want !== actual(artifact);
  });
}

function prepareAction<Context, Artifact extends ActionArtifact, Payload>(
  event: ActionServerEvent,
  specs: readonly ActionSpec<Context, Artifact, Payload>[],
  principal: CommandPrincipal,
): GateResolution<Context, Artifact, Payload> {
  const spec = specs.find((candidate) => candidate.name === event?.message?.action?.name);
  if (!spec) return { kind: "rejected", code: "UNSUPPORTED_ACTION", message: "The action is not supported." };

  const context = parseContext<Context>(spec.context, event?.message?.action?.context);
  if (!context) return { kind: "rejected", code: "INVALID_CONTEXT", message: "The action context is invalid." };

  let artifact: Artifact;
  try {
    artifact = spec.artifact.load(context, principal);
  } catch (error) {
    const loadRejected = spec.artifact.loadRejected ?? { code: "INVALID_ARTIFACT" as const, message: "No authoritative artifact is available." };
    return { kind: "rejected", code: spec.artifact.loadRejectedCode?.(error) ?? loadRejected.code, message: loadRejected.message };
  }
  if (
    (spec.artifact.kind !== undefined && artifact.kind !== spec.artifact.kind) ||
    (spec.artifact.schemaVersion !== undefined && artifact.schemaVersion !== spec.artifact.schemaVersion) ||
    (spec.artifact.validate !== undefined && !spec.artifact.validate(artifact))
  ) {
    return { kind: "rejected", code: "INVALID_ARTIFACT", message: "The authoritative artifact is invalid." };
  }

  const mismatch = spec.crossMatch?.(context, artifact);
  if (mismatch !== undefined && mismatch !== true) {
    return { kind: "rejected", code: mismatch.code, message: mismatch.message };
  }

  if (detectStale(spec.expect, context, artifact)) {
    return { kind: "rejected", code: "STALE_ACTION", message: spec.rejectionMessages.stale };
  }
  if (!spec.isAuthorized(context, artifact, principal)) {
    const rejected = spec.authorizationRejected ?? { code: "ACTION_NOT_AUTHORIZED" as const, message: "The requested action is not authorized." };
    return { kind: "rejected", code: rejected.code, message: rejected.message };
  }

  const command = spec.command?.(context, artifact);
  const envelope = command ? createPlatformCommandEnvelope({
    commandName: command.commandName,
    principal,
    payload: command.payload,
    ...(command.idempotencyKey === undefined ? {} : { idempotencyKey: command.idempotencyKey }),
    ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion }),
  }) : undefined;
  return { kind: "ready", spec, input: { context, artifact, principal, ...(envelope === undefined ? {} : { envelope }) } };
}

/** Resolves a consequential action synchronously. A pack whose `run` is async must use {@link resolveActionAsync}. */
export function resolveAction<Context, Artifact extends ActionArtifact, Payload>(
  event: ActionServerEvent,
  specs: readonly ActionSpec<Context, Artifact, Payload>[],
  principal: CommandPrincipal,
): ActionOutcome<Artifact> {
  const resolution = prepareAction(event, specs, principal);
  if (resolution.kind === "rejected") return reject(resolution.code, resolution.message);
  try {
    const artifact = resolution.spec.run(resolution.input);
    if (artifact instanceof Promise) return reject("ACTION_NOT_AUTHORIZED", resolution.spec.rejectionMessages.runRejected);
    return { ok: true, artifact };
  } catch (error) {
    return reject(resolution.spec.runRejectedCode?.(error) ?? "ACTION_NOT_AUTHORIZED", resolution.spec.rejectionMessages.runRejected);
  }
}

/** Resolves a consequential action whose pack `run` is asynchronous. */
export async function resolveActionAsync<Context, Artifact extends ActionArtifact, Payload>(
  event: ActionServerEvent,
  specs: readonly ActionSpec<Context, Artifact, Payload>[],
  principal: CommandPrincipal,
): Promise<ActionOutcome<Artifact>> {
  const resolution = prepareAction(event, specs, principal);
  if (resolution.kind === "rejected") return reject(resolution.code, resolution.message);
  try {
    return { ok: true, artifact: await resolution.spec.run(resolution.input) };
  } catch (error) {
    return reject(resolution.spec.runRejectedCode?.(error) ?? "ACTION_NOT_AUTHORIZED", resolution.spec.rejectionMessages.runRejected);
  }
}

