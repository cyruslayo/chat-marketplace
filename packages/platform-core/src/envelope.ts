export interface CommandPrincipal {
  id: string;
  role: "guest" | "operator" | "agent" | "system" | "admin" | "authorized_staff";
  tenantId?: string;
}

export interface PlatformCommandEnvelope<T = any> {
  commandId: string;
  commandName: string;
  principal: CommandPrincipal;
  idempotencyKey?: string;
  expectedVersion?: number | string;
  payload: T;
  timestamp: string;
}

export interface CreateCommandEnvelopeOptions<T> {
  commandName: string;
  principal: CommandPrincipal;
  payload: T;
  idempotencyKey?: string;
  expectedVersion?: number | string;
}

export function createPlatformCommandEnvelope<T>({
  commandName,
  principal,
  payload,
  idempotencyKey,
  expectedVersion
}: CreateCommandEnvelopeOptions<T>): PlatformCommandEnvelope<T> {
  if (!commandName || commandName.trim() === "") {
    throw new Error("Command envelope requires a valid commandName");
  }
  if (!principal || !principal.id || !principal.role) {
    throw new Error("Command envelope requires valid principal identity and role");
  }

  return Object.freeze({
    commandId: `cmd-${crypto.randomUUID()}`,
    commandName,
    principal: Object.freeze({ ...principal }),
    idempotencyKey: idempotencyKey ?? `idempotency-${crypto.randomUUID()}`,
    expectedVersion,
    payload: Object.freeze({ ...payload }),
    timestamp: new Date().toISOString()
  });
}
