import type { AuditLog } from "../../../packages/platform-core/src/index.js";
import type { UnitRepositoryContract } from "../../../domains/shortlet/src/browse.js";
import { importInventoryCsv, operatorResolverFromRepository } from "../../../domains/shortlet/src/inventory-import.js";
import { bootstrapOperatorsFromUnitRepository, type OperatorRepository } from "../../../domains/shortlet/src/operator.js";
import { readBodyWithLimit, BodyTooLargeError } from "./bounded-body.js";
import {
  runOperatorCreateCommand,
  runOperatorListCommand,
  runOperatorUpdateCommand,
} from "../../shortlet-ops/src/operator-cli.js";
import { ACCESS_JWT_HEADER, OPS_SECRET_HEADER, sharedSecretMatches } from "./ops-auth.js";
import type { AccessVerifier } from "./access-jwt.js";

/**
 * Slice 11a: the authenticated `/_ops/*` routes. They call exactly the domain functions the operator CLIs call
 * today — no new operator logic — behind two fail-closed layers (Cloudflare Access JWT + shared secret).
 *
 * ADR 0086: a provisioned access token is returned only in the JSON response body. It never appears in a URL, a
 * header, telemetry or the audit log (the audit records the operator and actor ids only).
 */
export interface OpsGrantAuthority {
  canActForOperator(input: { readonly actorId: string; readonly operatorId: string; readonly tenantId: string }): boolean;
}

export interface OpsSessionAuthority {
  provisionAccessToken(input: {
    readonly actorId: string;
    readonly tenantId: string;
    readonly representativeAuthorized: boolean;
  }): { readonly token: string; readonly expiresAt: string };
  revokeAll(actorId: string, tenantId: string): void;
}

export interface OpsRouteDependencies {
  readonly sharedSecret: string;
  readonly verifier: AccessVerifier;
  readonly operatorRepository: OperatorRepository;
  readonly unitRepository: UnitRepositoryContract;
  readonly grantStore: OpsGrantAuthority;
  readonly sessionAuthority: OpsSessionAuthority;
  readonly audit: AuditLog;
  readonly clock: () => Date;
  readonly tenantId: string;
}

export interface OpsHandler {
  /** Handles the request when its path is under `/_ops`, otherwise returns null. */
  handle(request: Request): Promise<Response | null>;
}

/** A JSON ops body is small; anything larger is refused before it is read (a bound, not a policy value). */
const MAX_OPS_BODY_BYTES = 64 * 1024;

/** The user-approved inventory CSV limit (5 MiB); enforced before the body is read. */
const MAX_INVENTORY_CSV_BYTES = 5 * 1024 * 1024;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function refusal(): Response {
  // Refused without detail: a caller cannot tell which layer failed (AGENTS.md anti-pattern 1).
  return json(401, { ok: false, code: "UNAUTHORIZED" });
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const bytes = await readBodyWithLimit(request, MAX_OPS_BODY_BYTES);
  if (bytes.byteLength === 0) return {};
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("A JSON object body is required");
  return parsed as Record<string, unknown>;
}

export function createOpsHandler(dependencies: OpsRouteDependencies): OpsHandler {
  const authorized = async (request: Request): Promise<boolean> => {
    try {
      const assertion = request.headers.get(ACCESS_JWT_HEADER);
      const accessOk = assertion !== null && assertion !== "" && (await dependencies.verifier.verify(assertion));
      const secretOk = sharedSecretMatches(request.headers.get(OPS_SECRET_HEADER), dependencies.sharedSecret);
      return accessOk && secretOk;
    } catch {
      return false;
    }
  };

  const record = (action: string, fields: Record<string, unknown>): void => {
    try {
      dependencies.audit.record({ action, ...fields, recordedAt: dependencies.clock().toISOString() });
    } catch {
      /* audit is best-effort; the operation itself already succeeded or failed on its own terms */
    }
  };

  const route = async (request: Request, url: URL): Promise<Response> => {
    const path = url.pathname;
    if (request.method === "POST" && path === "/_ops/operators") {
      const body = await readJsonBody(request);
      const result = runOperatorCreateCommand(
        dependencies.operatorRepository,
        ["--operator-id", requiredString(body.operatorId, "operatorId"), "--tenant-id", requiredString(body.tenantId, "tenantId"), "--name", requiredString(body.name, "name")],
        dependencies.clock(),
      );
      record("ops.operators.create", { operatorId: result.operator.id });
      return json(200, { ok: true, operator: result.summary });
    }
    if (request.method === "GET" && path === "/_ops/operators") {
      return json(200, { ok: true, operators: runOperatorListCommand(dependencies.operatorRepository).operators });
    }
    if (request.method === "POST" && path === "/_ops/operators/bootstrap") {
      const body = await readJsonBody(request);
      const tenantId = typeof body.tenantId === "string" && body.tenantId.trim() !== "" ? body.tenantId.trim() : dependencies.tenantId;
      const migrated = bootstrapOperatorsFromUnitRepository({
        units: dependencies.unitRepository,
        operators: dependencies.operatorRepository,
        tenantId,
        now: dependencies.clock(),
      });
      record("ops.operators.bootstrap", { tenantId, migrated: migrated.length });
      return json(200, { ok: true, migrated: migrated.length });
    }
    if (request.method === "POST" && path === "/_ops/inventory/import") {
      const tenantId = url.searchParams.get("tenantId")?.trim() || dependencies.tenantId;
      const dryRun = url.searchParams.get("dryRun") === "true";
      // The user-approved 5 MiB limit is enforced before a byte of the CSV is read.
      const csv = new TextDecoder().decode(await readBodyWithLimit(request, MAX_INVENTORY_CSV_BYTES));
      const result = importInventoryCsv(csv, {
        repository: dependencies.unitRepository,
        operatorResolver: operatorResolverFromRepository(dependencies.operatorRepository),
        tenantId,
        dryRun,
        clock: dependencies.clock,
      });
      record("ops.inventory.import", { tenantId, inserted: result.inserted, invalid: result.invalid });
      // The importer's own summary is returned verbatim; invalid rows are reported exactly as the CLI reports them.
      return json(200, { ok: true, ...result });
    }
    const operatorPath = /^\/_ops\/operators\/([^/]+)$/.exec(path);
    if (request.method === "PATCH" && operatorPath) {
      const body = await readJsonBody(request);
      const result = runOperatorUpdateCommand(dependencies.operatorRepository, [
        "--operator-id",
        decodeURIComponent(operatorPath[1]!),
        "--name",
        requiredString(body.name, "name"),
      ]);
      record("ops.operators.update", { operatorId: result.operator.id });
      return json(200, { ok: true, operator: result.summary });
    }
    const accessPath = /^\/_ops\/operators\/([^/]+)\/access$/.exec(path);
    if (accessPath && (request.method === "POST" || request.method === "DELETE")) {
      const operatorId = decodeURIComponent(accessPath[1]!);
      if (!dependencies.operatorRepository.findById(operatorId)) return json(404, { ok: false, code: "UNKNOWN_OPERATOR" });
      const body = await readJsonBody(request);
      const actorId = requiredString(body.actorId, "actorId");
      const tenantId = typeof body.tenantId === "string" && body.tenantId.trim() !== "" ? body.tenantId.trim() : dependencies.tenantId;
      if (request.method === "DELETE") {
        dependencies.sessionAuthority.revokeAll(actorId, tenantId);
        record("ops.operators.access.revoke", { operatorId, actorId, tenantId });
        return json(200, { ok: true, operatorId, actorId, tenantId, revoked: true });
      }
      const representativeAuthorized = dependencies.grantStore.canActForOperator({ actorId, operatorId, tenantId });
      const provisioned = dependencies.sessionAuthority.provisionAccessToken({ actorId, tenantId, representativeAuthorized });
      record("ops.operators.access.provision", { operatorId, actorId, tenantId });
      // ADR 0086: the token is returned only here, in the response body.
      return json(200, { ok: true, operatorId, actorId, tenantId, token: provisioned.token, expiresAt: provisioned.expiresAt });
    }
    return json(404, { ok: false, code: "NOT_FOUND" });
  };

  return {
    async handle(request: Request): Promise<Response | null> {
      const url = new URL(request.url);
      if (url.pathname !== "/_ops" && !url.pathname.startsWith("/_ops/")) return null;
      if (!(await authorized(request))) return refusal();
      try {
        return await route(request, url);
      } catch (error) {
        if (error instanceof BodyTooLargeError) return json(413, { ok: false, code: "BODY_TOO_LARGE" });
        return json(400, { ok: false, code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Bad request" });
      }
    },
  };
}
