import { DurableObject } from "cloudflare:workers";
import type { DurableObjectState } from "@cloudflare/workers-types";
import { applySchemaMigrations } from "../../../packages/platform-core/src/schema-migrations.js";
import { DurableObjectSqlDatabase } from "./do-sql-database.js";
import { PLATFORM_SCHEMA_MIGRATIONS } from "./schema.js";
import type { CloudflareEnv } from "./cloudflare-config.js";
import { lagosDate, runDailyExport } from "./do-export.js";
import { loadExportConfiguration } from "./cloudflare-config.js";
import { assertCutoverOpenForImport, assertSchemaCurrent, credentialTableCountsForOwner, exportTable, importBatch } from "./ops-import.js";
import { PLATFORM_SCHEMA_VERSION } from "./schema.js";
import { checksumTables } from "../../../packages/platform-core/src/data-migration.js";
import { schemaVersion } from "../../../packages/platform-core/src/schema-migrations.js";
import { completeCutoverWithMarker, cutoverStatus, createCutoverMarkerStore } from "./cutover-marker.js";
import { createPlatformAccounts } from "../../../packages/platform-core/src/accounts/accounts.js";
import type { GuestAccountAuthorityErrorCode } from "../../../packages/platform-core/src/accounts/authority.js";
import { usableCodeHashingKey } from "../../../packages/platform-core/src/accounts/remote-port.js";
import { SqliteGuestContactRepository } from "../../../packages/platform-core/src/accounts/contact.js";
import { shortletDomainClient } from "./do-clients.js";

const PLATFORM_DAILY_ALARM_MS = 24 * 60 * 60 * 1000;
const ACCOUNT_ERROR_CODES: ReadonlySet<string> = new Set(["invalid_input", "code_invalid", "code_expired", "code_consumed", "code_attempts_exhausted", "rate_limited", "session_invalid", "account_conflict", "action_proof_invalid"]);

/** ADR 0101 platform system of record, scoped to the same tenant key as each domain object. */
export class PlatformDO extends DurableObject<CloudflareEnv> {
  #accounts: ReturnType<typeof createPlatformAccounts> | null = null;
  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      applySchemaMigrations(new DurableObjectSqlDatabase(ctx.storage), PLATFORM_SCHEMA_MIGRATIONS, new Date().toISOString());
      const scheduled = await ctx.storage.getAlarm();
      if (scheduled === null) await ctx.storage.setAlarm(Date.now() + PLATFORM_DAILY_ALARM_MS);
    });
  }

  async alarm(): Promise<void> {
    const today = lagosDate(new Date());
    if ((await this.ctx.storage.get<string>("platform:export:lastDate")) !== today) {
      const configuration = loadExportConfiguration(this.env);
      await runDailyExport({
        database: new DurableObjectSqlDatabase(this.ctx.storage),
        exports: this.env.EXPORTS,
        clock: () => new Date(),
        retentionDays: configuration.retentionDays,
        orphanGraceHours: configuration.orphanGraceHours,
        tableOwner: "platform",
      });
      await this.ctx.storage.put("platform:export:lastDate", today);
    }
    await this.ctx.storage.setAlarm(Date.now() + PLATFORM_DAILY_ALARM_MS);
  }

  async fetch(_request: Request): Promise<Response> {
    const url = new URL(_request.url);
    if (url.pathname.startsWith("/_internal/")) return this.#handleInternal(_request, url.pathname);
    if (url.pathname === "/account" || url.pathname.startsWith("/account/")) {
      const tenantId = this.env.SHORTLET_TENANT_ID?.trim() ?? "";
      if (!tenantId) return new Response("Not found", { status: 404 });
      // The domain serves the conventional account UI; all account reads and mutations inside it use the typed PLATFORM RPC.
      const shortlet = this.env.SHORTLET.get(this.env.SHORTLET.idFromName(tenantId), { locationHint: "afr" });
      return await shortlet.fetch(_request as unknown as import("@cloudflare/workers-types").Request) as unknown as Response;
    }
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  async #handleInternal(request: Request, path: string): Promise<Response> {
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    let body: unknown;
    try { body = await request.json(); } catch { return new Response("Bad request", { status: 400 }); }
    if (body === null || typeof body !== "object" || Array.isArray(body)) return new Response("Bad request", { status: 400 });
    const input = body as Record<string, unknown>;
    const tenantId = this.env.SHORTLET_TENANT_ID?.trim() ?? "";
    if (!tenantId || input.tenantId !== tenantId) {
      return Response.json({ ok: false, code: "INVALID_SCOPE" }, { status: 400 });
    }
    const database = new DurableObjectSqlDatabase(this.ctx.storage);
    if (path.startsWith("/_internal/guest-data/")) return this.#handleGuestData(database, path.slice("/_internal/guest-data/".length), input);
    if (path.startsWith("/_internal/accounts/")) return this.#handleAccountRpc(database, path.slice("/_internal/accounts/".length), input);
    if (path.startsWith("/_internal/ops/")) return await this.#handleOpsInternal(database, path.slice("/_internal/ops/".length), input);
    if (path !== "/_internal/account-assurance-state" || typeof input.accountGuestId !== "string" || input.accountGuestId.trim() === "" || Object.keys(input).length !== 2) {
      return new Response("Not found", { status: 404 });
    }
    const row = database.prepare("SELECT status, email_revision FROM guest_accounts WHERE tenant_id = ? AND account_guest_id = ?")
      .get([tenantId, input.accountGuestId]);
    if (!row) return Response.json({ status: "missing" });
    if (row.status === "closed") return Response.json({ status: "closed" });
    if (row.status !== "active" || !Number.isSafeInteger(row.email_revision) || Number(row.email_revision) < 0) {
      return Response.json({ ok: false, code: "ACCOUNT_STATE_UNAVAILABLE" }, { status: 503 });
    }
    return Response.json({ status: "active", emailRevision: Number(row.email_revision) });
  }

  #handleGuestData(database: DurableObjectSqlDatabase, operation: string, input: Record<string, unknown>): Response {
    const tenantId = this.env.SHORTLET_TENANT_ID?.trim() ?? "";
    const text = (key: string): string | null => typeof input[key] === "string" && (input[key] as string).trim() !== "" ? input[key] as string : null;
    const row = (raw: Record<string, unknown> | undefined) => raw ? ({
      threadId: String(raw.thread_id), principalId: String(raw.principal_id), tenantId: String(raw.tenant_id), threadJson: String(raw.thread_json),
    }) : null;
    if (operation === "findSessionBinding") {
      const sessionId = text("sessionId"); if (!sessionId) return new Response("Bad request", { status: 400 });
      const found = database.prepare("SELECT session_id, session_secret_hash, principal_id, tenant_id FROM guest_session_bindings WHERE session_id = ? AND tenant_id = ?").get([sessionId, tenantId]);
      return Response.json({ result: found ? { sessionId: found.session_id, sessionSecretHash: found.session_secret_hash, principalId: found.principal_id, tenantId: found.tenant_id } : null });
    }
    if (operation === "saveSessionBinding") {
      const sessionId = text("sessionId"), hash = text("sessionSecretHash"), principalId = text("principalId");
      if (!sessionId || !hash || !principalId) return new Response("Bad request", { status: 400 });
      database.prepare("INSERT INTO guest_session_bindings (session_id, session_secret_hash, principal_id, tenant_id) VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET session_secret_hash=excluded.session_secret_hash, principal_id=excluded.principal_id, tenant_id=excluded.tenant_id").run([sessionId, hash, principalId, tenantId]);
      return Response.json({ result: null });
    }
    if (operation === "deleteSessionBinding") {
      const sessionId = text("sessionId"); if (!sessionId) return new Response("Bad request", { status: 400 });
      database.prepare("DELETE FROM guest_session_bindings WHERE session_id = ? AND tenant_id = ?").run([sessionId, tenantId]);
      return Response.json({ result: null });
    }
    if (operation === "deleteSessionBindingsForPrincipals") {
      if (!Array.isArray(input.principalIds) || input.principalIds.some((id) => typeof id !== "string")) return new Response("Bad request", { status: 400 });
      for (const principalId of input.principalIds) database.prepare("DELETE FROM guest_session_bindings WHERE principal_id = ? AND tenant_id = ?").run([principalId, tenantId]);
      return Response.json({ result: null });
    }
    if (operation === "saveThread") {
      const threadId = text("threadId"), principalId = text("principalId"), threadJson = text("threadJson");
      if (!threadId || !principalId || !threadJson || input.tenantId !== tenantId) return new Response("Bad request", { status: 400 });
      database.prepare("INSERT INTO guest_threads (thread_id, principal_id, tenant_id, thread_json) VALUES (?, ?, ?, ?) ON CONFLICT(thread_id) DO UPDATE SET principal_id=excluded.principal_id, tenant_id=excluded.tenant_id, thread_json=excluded.thread_json").run([threadId, principalId, tenantId, threadJson]);
      return Response.json({ result: null });
    }
    if (operation === "findThread") {
      const threadId = text("threadId"); if (!threadId) return new Response("Bad request", { status: 400 });
      return Response.json({ result: row(database.prepare("SELECT * FROM guest_threads WHERE thread_id = ? AND tenant_id = ?").get([threadId, tenantId])) });
    }
    if (operation === "findThreadsForPrincipal" || operation === "findThreadsForPrincipals") {
      const principals = operation === "findThreadsForPrincipal" ? [text("principalId")] : input.principalIds;
      if (!Array.isArray(principals) || principals.some((id) => typeof id !== "string")) return new Response("Bad request", { status: 400 });
      if (principals.length === 0) return Response.json({ result: [] });
      const rows = database.prepare(`SELECT * FROM guest_threads WHERE tenant_id = ? AND principal_id IN (${principals.map(() => "?").join(",")}) ORDER BY thread_id`).all([tenantId, ...principals]);
      return Response.json({ result: rows.map((item) => row(item)) });
    }
    if (operation === "findContact" || operation === "savePhone" || operation === "saveEmail") {
      const guestId = text("guestId"); if (!guestId) return new Response("Bad request", { status: 400 });
      const contacts = new SqliteGuestContactRepository(database);
      const linked = database.prepare("SELECT account_guest_id FROM guest_account_principals WHERE principal_id = ? AND tenant_id = ?").get([guestId, tenantId]);
      const accountGuestId = typeof linked?.account_guest_id === "string" ? linked.account_guest_id : null;
      if (operation === "findContact") {
        const own = contacts.find(guestId, tenantId);
        if (!accountGuestId) return Response.json({ result: own });
        const account = database.prepare("SELECT email_normalized, status FROM guest_accounts WHERE account_guest_id = ? AND tenant_id = ?").get([accountGuestId, tenantId]);
        const accountContact = contacts.find(accountGuestId, tenantId);
        return Response.json({ result: { guestId, tenantId, phoneNumber: accountContact?.phoneNumber ?? own?.phoneNumber ?? null, contactEmail: account?.status === "active" && typeof account.email_normalized === "string" ? account.email_normalized : null, revision: accountContact?.revision ?? 0, accountEmailOwned: true } });
      }
      if (operation === "saveEmail" && accountGuestId) return Response.json({ ok: false, code: "account_email_owned" }, { status: 409 });
      const expectedRevision = Number.isSafeInteger(input.expectedRevision) ? Number(input.expectedRevision) : undefined;
      const effectiveGuestId = operation === "savePhone" ? accountGuestId ?? guestId : guestId;
      const result = operation === "savePhone"
        ? contacts.savePhone({ guestId: effectiveGuestId, tenantId, phoneNumber: String(input.phoneNumber ?? ""), ...(expectedRevision === undefined ? {} : { expectedRevision }) })
        : contacts.saveEmail({ guestId: effectiveGuestId, tenantId, contactEmail: String(input.contactEmail ?? ""), ...(expectedRevision === undefined ? {} : { expectedRevision }) });
      return Response.json({ result });
    }
    return new Response("Not found", { status: 404 });
  }

  #accountRuntime(database: DurableObjectSqlDatabase): ReturnType<typeof createPlatformAccounts> {
    if (this.#accounts) return this.#accounts;
    const tenantId = this.env.SHORTLET_TENANT_ID?.trim() ?? "";
    const key = usableCodeHashingKey(this.env.SHORTLET_GUEST_CODE_HASHING_KEY);
    if (!tenantId || !key) throw new Error("Platform account authority is not configured");
    const domain = shortletDomainClient(this.env, tenantId);
    return this.#accounts = createPlatformAccounts({
      database, tenantId, codeHashingKey: key, clock: () => new Date(), requests: { findBookingRequestIdsByContactEmail: () => [] },
      asyncRequests: { findBookingRequestIdsByContactEmail: (email, tenant) => domain.findBookingRequestIdsByContactEmail(email, tenant) },
    });
  }

  async #handleAccountRpc(database: DurableObjectSqlDatabase, operation: string, input: Record<string, unknown>): Promise<Response> {
    const accounts = this.#accountRuntime(database);
    const args = input.args;
    if (args === null || typeof args !== "object" || Array.isArray(args)) return new Response("Bad request", { status: 400 });
    const value = args as Record<string, unknown>;
    if (value.tenantId !== undefined && value.tenantId !== this.env.SHORTLET_TENANT_ID?.trim()) return Response.json({ ok: false, code: "INVALID_SCOPE" }, { status: 403 });
    try {
      let result: unknown;
      switch (operation) {
        case "requestCode": result = accounts.authority.requestCode(value as Parameters<typeof accounts.authority.requestCode>[0]); break;
        case "verifyCode": result = accounts.authority.verifyCode(value as unknown as Parameters<typeof accounts.authority.verifyCode>[0]); break;
        case "findAccount": result = accounts.authority.findAccount(String(value.accountGuestId ?? ""), String(value.tenantId ?? "")); break;
        case "resolveSession": result = accounts.authority.resolveSession(String(value.sessionId ?? ""), String(value.sessionSecret ?? "")); break;
        case "changeEmail": result = accounts.authority.changeEmail(value as Parameters<typeof accounts.authority.changeEmail>[0]); break;
        case "replayEmailChange": result = accounts.authority.replayEmailChange(value as Parameters<typeof accounts.authority.replayEmailChange>[0]); break;
        case "markEmailChangeAssuranceCleanupComplete": accounts.authority.markEmailChangeAssuranceCleanupComplete(value as Parameters<typeof accounts.authority.markEmailChangeAssuranceCleanupComplete>[0]); result = null; break;
        case "revokeSession": accounts.authority.revokeSession(String(value.sessionId ?? ""), String(value.tenantId ?? "")); result = null; break;
        case "revokeAllSessions": accounts.authority.revokeAllSessions(String(value.accountGuestId ?? ""), String(value.tenantId ?? "")); result = null; break;
        case "linkSignedInPrincipalWithLookup": result = await accounts.links.linkSignedInPrincipalWithLookup(value as Parameters<typeof accounts.links.linkSignedInPrincipalWithLookup>[0]); break;
        case "accountForPrincipal": result = accounts.links.accountForPrincipal(String(value.principalId ?? "")); break;
        case "linkedPrincipals": result = accounts.links.linkedPrincipals(String(value.accountGuestId ?? ""), String(value.tenantId ?? "")); break;
        case "claimedRequestIds": result = accounts.links.claimedRequestIds(String(value.accountGuestId ?? ""), String(value.tenantId ?? "")); break;
        default: return new Response("Not found", { status: 404 });
      }
      return Response.json({ ok: true, result });
    } catch (error) {
      const err = error as { code?: unknown; retryAfterSeconds?: unknown; message?: unknown };
      const code = typeof err.code === "string" && ACCOUNT_ERROR_CODES.has(err.code) ? err.code as GuestAccountAuthorityErrorCode : "invalid_input";
      return Response.json({ ok: false, code, retryAfterSeconds: err.retryAfterSeconds }, { status: 400 });
    }
  }

  async #handleOpsInternal(database: DurableObjectSqlDatabase, operation: string, input: Record<string, unknown>): Promise<Response> {
    const marker = createCutoverMarkerStore(this.env.EXPORTS, this.ctx.id.toString(), "platform");
    try {
      if (operation === "import" && Object.keys(input).length === 3 && typeof input.table === "string" && Array.isArray(input.rows)) {
        assertSchemaCurrent(database, PLATFORM_SCHEMA_VERSION);
        await assertCutoverOpenForImport(database, marker);
        return Response.json({ ok: true, ...importBatch(database, input.table, input.rows, PLATFORM_SCHEMA_VERSION, new Date()) });
      }
      if (operation === "export" && Object.keys(input).length === 2 && typeof input.table === "string") {
        return Response.json({ ok: true, ...(await exportTable(database, input.table)) });
      }
      if ((operation === "verify" || operation === "status") && Object.keys(input).length === 1) {
        const cutover = await cutoverStatus(database, marker);
        return Response.json({
          ok: true,
          schemaVersion: schemaVersion(database),
          expectedSchemaVersion: PLATFORM_SCHEMA_VERSION,
          ...(operation === "verify" ? {
            tables: await checksumTables(database),
            excludedTables: Object.fromEntries(Object.entries(credentialTableCountsForOwner(database, "platform")).map(([table, rowCount]) => [table, { rowCount }])),
          } : {}),
          cutoverCompletedAt: cutover.completedAt,
          cutoverMarker: cutover.marker,
        });
      }
      if (operation === "cutover" && Object.keys(input).length === 1) {
        assertSchemaCurrent(database, PLATFORM_SCHEMA_VERSION);
        const completedAt = await completeCutoverWithMarker(database, marker, new Date().toISOString());
        return Response.json({ ok: true, cutoverCompletedAt: completedAt });
      }
      return new Response("Not found", { status: 404 });
    } catch {
      return Response.json({ ok: false, code: "PLATFORM_MIGRATION_OPERATION_FAILED" }, { status: 400 });
    }
  }
}
