import type { AuditLog } from "../../../packages/platform-core/src/index.js";
import type { UnitRepositoryContract } from "../../../domains/shortlet/src/index.js";
import { importInventoryCsv, operatorResolverFromRepository } from "../../../domains/shortlet/src/index.js";
import { bootstrapOperatorsFromUnitRepository, type OperatorRepository } from "../../../domains/shortlet/src/index.js";
import { readBodyWithLimit, BodyTooLargeError } from "./bounded-body.js";
import {
  runOperatorCreateCommand,
  runOperatorListCommand,
  runOperatorUpdateCommand,
} from "../../shortlet-ops/src/operator-cli.js";
import { ACCESS_JWT_HEADER, OPS_SECRET_HEADER, sharedSecretMatches } from "./ops-auth.js";
import type { AccessVerifier } from "./access-jwt.js";
import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import {
  CREDENTIAL_TABLE_REFUSAL,
  MAX_IMPORT_REQUEST_BYTES,
  checksumTables,
  isCredentialTable,
} from "../../../packages/platform-core/src/data-migration.js";
import { CutoverMarkerUnavailableError, completeCutoverWithMarker, cutoverStatus, type CutoverMarkerStore } from "./cutover-marker.js";
import { ImportRefusedError, assertCutoverOpenForImport, assertSchemaCurrent, credentialTableCountsForOwner, exportTable, importBatch } from "./ops-import.js";
import { SHORTLET_SCHEMA_VERSION } from "./schema.js";
import { schemaVersion } from "../../../packages/platform-core/src/schema-migrations.js";
import { PLATFORM_OWNED_TABLES } from "./do-export.js";

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

/** Slice 12b: Durable Object point-in-time recovery bookmarks. */
export interface OpsStorageBookmarks {
  bookmarkForTime(timeMs: number): Promise<string>;
  restoreOnNextSession(bookmark: string): void | Promise<void>;
}

export interface OpsRouteDependencies {
  /** Slice 16: the object's SQL handle, used by the import, verify and export routes. */
  readonly database: SqlDatabase;
  readonly sharedSecret: string;
  readonly verifier: AccessVerifier;
  readonly operatorRepository: OperatorRepository;
  readonly unitRepository: UnitRepositoryContract;
  readonly grantStore: OpsGrantAuthority;
  readonly sessionAuthority: OpsSessionAuthority;
  readonly storageBookmarks: OpsStorageBookmarks;
  /** Issue 16 A: the cutover marker in the private EXPORTS bucket, outside the object's rewound storage. */
  readonly cutoverMarker: CutoverMarkerStore;
  readonly audit: AuditLog;
  readonly clock: () => Date;
  readonly tenantId: string;
  readonly platformMigration?: {
    request<T>(operation: "import" | "export" | "verify" | "status" | "cutover", input?: Readonly<Record<string, unknown>>): Promise<T>;
  };
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

async function readJsonBody(request: Request, limit = MAX_OPS_BODY_BYTES): Promise<Record<string, unknown>> {
  const bytes = await readBodyWithLimit(request, limit);
  if (bytes.byteLength === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // The parser's own message quotes part of the body, which is row data (ADR 0075), so it is never returned.
    throw new Error("The request body is not valid JSON");
  }
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
    if (request.method === "POST" && path === "/_ops/restore") {
      // 12b: two-step point-in-time recovery. A dry run returns the bookmark to use; the confirm step must carry
      // that bookmark, so a confirm without a prior dry run is refused.
      const body = await readJsonBody(request);
      if (body.confirm !== true) {
        const timeMs = typeof body.timeMs === "number" && Number.isFinite(body.timeMs) ? body.timeMs : dependencies.clock().getTime();
        const bookmark = await dependencies.storageBookmarks.bookmarkForTime(timeMs);
        record("ops.restore.dry_run", { timeMs });
        return json(200, { ok: true, bookmark, restartRequired: false });
      }
      const bookmark = requiredString(body.bookmark, "bookmark");
      await dependencies.storageBookmarks.restoreOnNextSession(bookmark);
      record("ops.restore.scheduled", {});
      // The restore takes effect on the object's next session; the operator restarts (or evicts) the object.
      return json(200, { ok: true, scheduled: true, restartRequired: true });
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
    if (request.method === "POST" && path === "/_ops/import") {
      // Slice 16: one batch in one transaction (ops-import.ts). The batch is bounded by the reused 11b limit.
      // The request bound is the documented chunk size (data-migration.ts), enforced before the body is read.
      const body = await readJsonBody(request, MAX_IMPORT_REQUEST_BYTES);
      const table = requiredString(body.table, "table");
      if (!Array.isArray(body.rows)) throw new Error("rows must be an array");
      if (PLATFORM_OWNED_TABLES.has(table)) {
        if (!dependencies.platformMigration) throw new Error("PLATFORM migration authority is unavailable");
        return json(200, await dependencies.platformMigration.request("import", { table, rows: body.rows }));
      }
      // Issue 16 A: the schema, then the cutover marker and flag, are checked before any write (fail closed).
      assertSchemaCurrent(dependencies.database, SHORTLET_SCHEMA_VERSION);
      await assertCutoverOpenForImport(dependencies.database, dependencies.cutoverMarker);
      const result = importBatch(dependencies.database, table, body.rows, SHORTLET_SCHEMA_VERSION, dependencies.clock());
      // No audit record: the audit log is itself migrated, so an import must not add rows to it.
      return json(200, { ok: true, ...result });
    }
    if (request.method === "POST" && path === "/_ops/cutover/complete") {
      // ADR 0101: record cutover independently in both authorities. Each object persists its own marker before its SQL flag.
      assertSchemaCurrent(dependencies.database, SHORTLET_SCHEMA_VERSION);
      try {
        const platform = dependencies.platformMigration
          ? await dependencies.platformMigration.request<{ readonly cutoverCompletedAt: string }>("cutover")
          : null;
        const completedAt = await completeCutoverWithMarker(dependencies.database, dependencies.cutoverMarker, dependencies.clock().toISOString());
        return json(200, { ok: true, cutoverCompletedAt: completedAt, platformCutoverCompletedAt: platform?.cutoverCompletedAt ?? null });
      } catch (error) {
        // Fail closed. A marker failure leaves the cutover unrecorded; a flag failure after the marker is finished by running this again.
        if (error instanceof CutoverMarkerUnavailableError) {
          return json(503, { ok: false, code: "CUTOVER_MARKER_UNAVAILABLE", message: "The cutover marker could not be written, so the cutover is not recorded. Nothing changed; run it again." });
        }
        return json(503, { ok: false, code: "CUTOVER_NOT_RECORDED", message: "The cutover marker is set but the object's flag was not recorded. Run this step again to finish it." });
      }
    }
    if (request.method === "GET" && path === "/_ops/status") {
      // F3 and A: the cutover is read from the database flag and the R2 marker. A restore that rewinds the flag cannot hide the marker.
      const cutover = await cutoverStatus(dependencies.database, dependencies.cutoverMarker);
      const platform = dependencies.platformMigration
        ? await dependencies.platformMigration.request<Record<string, unknown>>("status")
        : null;
      return json(200, {
        ok: true,
        schemaVersion: schemaVersion(dependencies.database),
        expectedSchemaVersion: SHORTLET_SCHEMA_VERSION,
        cutoverCompletedAt: cutover.completedAt,
        cutoverMarker: cutover.marker,
        platform,
      });
    }
    if (request.method === "GET" && path === "/_ops/import/verify") {
      // Application tables are compared with the manifest. The credential tables are reported apart, as counts only (issue 16 B).
      const cutover = await cutoverStatus(dependencies.database, dependencies.cutoverMarker);
      const platform = dependencies.platformMigration
        ? await dependencies.platformMigration.request<Record<string, unknown>>("verify")
        : null;
      return json(200, {
        ok: true,
        schemaVersion: schemaVersion(dependencies.database),
        tables: await checksumTables(dependencies.database),
        excludedTables: Object.fromEntries(Object.entries(credentialTableCountsForOwner(dependencies.database, "shortlet")).map(([table, rowCount]) => [table, { rowCount }])),
        cutoverCompletedAt: cutover.completedAt,
        cutoverMarker: cutover.marker,
        platform,
      });
    }
    if (request.method === "GET" && path === "/_ops/export") {
      // Slice 16 / ADR 0101: reverse export is routed to the table's owning object.
      const table = requiredString(url.searchParams.get("table"), "table");
      if (isCredentialTable(table)) throw new ImportRefusedError("EXCLUDED_TABLE", CREDENTIAL_TABLE_REFUSAL);
      if (PLATFORM_OWNED_TABLES.has(table)) {
        if (!dependencies.platformMigration) throw new Error("PLATFORM migration authority is unavailable");
        return json(200, await dependencies.platformMigration.request("export", { table }));
      }
      return json(200, { ok: true, ...(await exportTable(dependencies.database, table)) });
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
        if (error instanceof ImportRefusedError) {
          // A rejected batch (BATCH_REJECTED, a database constraint failure) is 422 (nothing written); a schema that is not ready or a
          // completed cutover is 409 (nothing written); a cutover marker that cannot be read or written is 503 (nothing written, fail
          // closed). A refused table, column or row shape is 400, and so is an identity assurance row that fails validation
          // (IDENTITY_ASSURANCE_REFUSED, ADR 0094), which names no value.
          const status =
            error.code === "BATCH_REJECTED" ? 422
            : error.code === "SCHEMA_NOT_READY" || error.code === "CUTOVER_COMPLETE" ? 409
            : error.code === "CUTOVER_MARKER_UNAVAILABLE" ? 503
            : 400;
          return json(status, { ok: false, code: error.code, message: error.message });
        }
        return json(400, { ok: false, code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Bad request" });
      }
    },
  };
}
