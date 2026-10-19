import { DurableObject } from "cloudflare:workers";
import type { DurableObjectState } from "@cloudflare/workers-types";
import { applySchemaMigrations } from "../../../packages/platform-core/src/schema-migrations.js";
import { DirectPaystackClient, PaystackBankTransferClient, PaystackPayments } from "../../../packages/platform-core/src/payments/index.js";
import { SqliteOperatorRepository } from "../../../domains/shortlet/src/index.js";
import { SqliteOperatorRepresentativeGrantStore } from "../../../domains/shortlet/src/index.js";
import { SqliteOperatorSessionAuthority } from "../../../domains/shortlet/src/index.js";
import { SqliteUnitRepository } from "../../../domains/shortlet/src/index.js";
import { SqliteAuditLog } from "../../../packages/platform-core/src/sqlite-audit-log.js";
import type { TelemetryEvent } from "../../../packages/platform-core/src/telemetry.js";
import { createConciergeModelClient } from "../../local-guest/src/assistant/concierge-configuration.js";
import { ModelCallBudget } from "../../local-guest/src/assistant/model-call-budget.js";
import { LocalGuestEnvironment } from "../../local-guest/src/fixture.js";
import { GUEST_CODE_HASHING_KEY_ENV, loadGuestAccountComposition } from "../../local-guest/src/guest-account-composition.js";
import { GUEST_COMMERCE_COMPOSITION, createGuestRequestHandler } from "../../local-guest/src/guest-server.js";
import { LocalApartmentOwnerEnvironment, createOwnerRequestHandler } from "../../local-owner/src/index.js";
import { ResendEmailSender } from "../../pilot/src/notifications/email-sender.js";
import { PilotNotifier } from "../../pilot/src/notifications/pilot-notifier.js";
import { createPilotRequestHandler, type PilotRequestHandler } from "../../pilot/src/pilot-request-handler.js";
import {
  cloudflareProvisioningState,
  loadCloudflareConfiguration,
  loadExportConfiguration,
  loadOpsConfiguration,
  type CloudflareConfiguration,
  type CloudflareEnv,
  type CloudflareProvisioningState,
} from "./cloudflare-config.js";
import { runAlarmTasks, type AlarmTask } from "./do-alarm.js";
import { lagosDate, runDailyExport } from "./do-export.js";
import { DurableObjectSqlDatabase } from "./do-sql-database.js";
import { clientAddressFromCloudflareHeaderValue, createHttpResponseLike, toHttpRequestLike } from "./http-shim.js";
import { createCutoverMarkerStore, reconcileCutover } from "./cutover-marker.js";
import { createOpsHandler, type OpsHandler } from "./ops-routes.js";
import { SHORTLET_SCHEMA_MIGRATIONS } from "./schema.js";
import { cloudflareAssetLoader } from "./pilot-assets.js";
import { R2ReceiptBlobStore } from "./r2-receipt-blob-store.js";
import { commerceMigrationClient, platformGuestAccountDependencies, platformGuestData, platformMigrationClient } from "./do-clients.js";

/**
 * The assembled pilot (ADR 0004/0095): one SQLite-backed Durable Object is the single system of record. It builds
 * the existing Guest and Operator compositions with injected dependencies (04a/04b), serves them over the
 * Fetch-to-node-HTTP shim (09c), stores receipts in R2 (07b) and sweeps notifications from an alarm (the Node
 * notifier's `setInterval`).
 */
interface PilotRuntime {
  readonly configuration: CloudflareConfiguration;
  readonly database: DurableObjectSqlDatabase;
  readonly unitRepository: SqliteUnitRepository;
  readonly operatorRepository: SqliteOperatorRepository;
  readonly handler: PilotRequestHandler;
  /** Null when notifications are not configured, exactly as Node's null notifier. */
  readonly notifier: PilotNotifier | null;
}

/** 11a dispatches authenticated provisioning under this prefix, before the gate below. */
const OPS_PREFIX = "/_ops";

/**
 * The alarm's cadence when no notifier sweep is configured (or no runtime exists yet). The daily export needs one alarm per
 * Lagos day, and 24 hours gives exactly one. A scheduling interval, not a policy value.
 */
const DAILY_ALARM_MS = 24 * 60 * 60 * 1000;

function isOpsPath(pathname: string): boolean {
  return pathname === OPS_PREFIX || pathname.startsWith(`${OPS_PREFIX}/`);
}

export class ShortletPilot extends DurableObject<CloudflareEnv> {
  #runtime: PilotRuntime | null = null;
  #opsHandler: OpsHandler | null = null;
  #alarmScheduled = false;

  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    // D3: the ordered migrations run before the object serves any request. A failing migration resets the object, so
    // it never serves a half-migrated schema. Fresh and migrated objects take the same path.
    void ctx.blockConcurrencyWhile(async () => {
      const database = new DurableObjectSqlDatabase(ctx.storage);
      applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, new Date().toISOString());
      // A (issue 16): on start, the database flag is re-asserted from the R2 marker, so a restore that rewound the flag cannot
      // reopen imports. A failure here is not fatal: the object still starts, and the import path reconciles and refuses (fail closed).
      try {
        await reconcileCutover(database, createCutoverMarkerStore(env.EXPORTS, ctx.id.toString(), "shortlet"));
      } catch {
        console.log(JSON.stringify({ event: "cutover_reconcile_deferred" }));
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/_internal" || url.pathname.startsWith("/_internal/")) return this.#handleInternal(request, url.pathname);
    // 11a: authenticated ops routes are dispatched first, so provisioning does not depend on the guest/owner
    // configuration (Paystack, concierge) being valid, nor on the tenant being provisioned yet.
    // F1: the alarm (the daily export, and the notifier sweep when configured) is scheduled on every path, including the
    // ops routes and an unprovisioned object, so the export does not depend on the notifier or on the guest runtime.
    if (isOpsPath(url.pathname)) {
      await this.#ensureAlarm(null);
      return this.#handleOps(request);
    }

    const database = new DurableObjectSqlDatabase(this.ctx.storage);
    let configuration: CloudflareConfiguration;
    let provisioning: CloudflareProvisioningState;
    try {
      configuration = loadCloudflareConfiguration(this.env);
      provisioning = cloudflareProvisioningState(configuration, database);
    } catch {
      // Fail closed without detail: a malformed configuration or inconsistent inventory is never served.
      await this.#ensureAlarm(null);
      return this.#unavailable();
    }

    // 10a's user-approved first boot: normal routes and health return 503 "not provisioned" until valid
    // tenant-matching inventory and operators exist; authenticated provisioning above stays available.
    if (!provisioning.provisioned) {
      await this.#ensureAlarm(null);
      return this.#notProvisioned();
    }

    const runtime = (this.#runtime ??= this.#buildRuntime(configuration, provisioning));
    await this.#ensureAlarm(runtime);

    const stream = createHttpResponseLike();
    try {
      await runtime.handler.handle(toHttpRequestLike(request), stream.response);
    } catch (error) {
      // A handler that throws is answered as a 500 (09c); no Promise is left hanging.
      stream.response.destroy(error instanceof Error ? error : new Error(String(error)));
    }
    return await stream.done;
  }

  async #handleInternal(request: Request, path: string): Promise<Response> {
    const tenantId = this.env.SHORTLET_TENANT_ID?.trim() ?? "";
    if (!tenantId || request.method !== "POST") return new Response("Not found", { status: 404 });
    let body: unknown;
    try { body = await request.json(); } catch { return new Response("Bad request", { status: 400 }); }
    if (body === null || typeof body !== "object" || Array.isArray(body)) return new Response("Bad request", { status: 400 });
    const input = body as Record<string, unknown>;
    if (input.tenantId !== tenantId) return Response.json({ ok: false, code: "INVALID_SCOPE" }, { status: 403 });
    const database = new DurableObjectSqlDatabase(this.ctx.storage);
    if (path === "/_internal/guest-request-contact-matches") {
      if (typeof input.contactEmail !== "string" || input.contactEmail.trim() === "") return new Response("Bad request", { status: 400 });
      const matches = database.prepare(`SELECT r.request_id, r.primary_guest_id, r.tenant_id
        FROM guest_booking_request_contacts c
        JOIN guest_booking_requests r ON r.request_id = c.request_id AND r.tenant_id = c.tenant_id
        WHERE c.tenant_id = ? AND c.contact_email = ? ORDER BY r.request_id`).all([tenantId, input.contactEmail]);
      return Response.json({ matches: matches.map((row) => ({ requestId: row.request_id, primaryGuestId: row.primary_guest_id, tenantId: row.tenant_id })) });
    }
    if (path === "/_internal/guest-identity-assurance/invalidate") {
      if (typeof input.accountGuestId !== "string" || input.accountGuestId.trim() === "") return new Response("Bad request", { status: 400 });
      const deleted = database.prepare("DELETE FROM guest_identity_assurance WHERE tenant_id = ? AND account_guest_id = ?").run([tenantId, input.accountGuestId]);
      return Response.json({ ok: true, deleted: deleted.changes });
    }
    return new Response("Not found", { status: 404 });
  }

  /**
   * 11a: authenticated operator routes, dispatched before the guest/owner routes and before the provisioning gate,
   * so provisioning stays available on an unprovisioned object. The composition here is deliberately lighter than
   * the guest/owner runtime: the operator, unit, grant, session and audit authorities on the shared handle only.
   */
  async #handleOps(request: Request): Promise<Response> {
    try {
      const handler = (this.#opsHandler ??= this.#buildOpsHandler());
      const response = await handler.handle(request);
      return response ?? new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    } catch {
      return new Response(JSON.stringify({ ok: false, code: "UNAVAILABLE" }), {
        status: 503,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
  }

  #buildOpsHandler(): OpsHandler {
    const clock = (): Date => new Date();
    const database = new DurableObjectSqlDatabase(this.ctx.storage);
    const ops = loadOpsConfiguration(this.env);
    return createOpsHandler({
      database,
      sharedSecret: ops.sharedSecret,
      verifier: ops.verifier,
      operatorRepository: new SqliteOperatorRepository(database, { clock }),
      unitRepository: new SqliteUnitRepository(database),
      grantStore: new SqliteOperatorRepresentativeGrantStore(database, { clock }),
      sessionAuthority: new SqliteOperatorSessionAuthority(database, { clock }),
      storageBookmarks: {
        bookmarkForTime: (timeMs) => this.ctx.storage.getBookmarkForTime(timeMs),
        restoreOnNextSession: (bookmark) => { this.ctx.storage.onNextSessionRestoreBookmark(bookmark); },
      },
      cutoverMarker: createCutoverMarkerStore(this.env.EXPORTS, this.ctx.id.toString(), "shortlet"),
      audit: new SqliteAuditLog(database),
      clock,
      tenantId: this.env.SHORTLET_TENANT_ID?.trim() ?? "",
      platformMigration: platformMigrationClient(this.env, this.env.SHORTLET_TENANT_ID?.trim() ?? ""),
      commerceMigration: commerceMigrationClient(this.env, this.env.SHORTLET_TENANT_ID?.trim() ?? ""),
    });
  }

  #notProvisioned(): Response {
    return new Response(JSON.stringify({ ok: false, code: "NOT_PROVISIONED" }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  #unavailable(): Response {
    return new Response(JSON.stringify({ ok: false, code: "UNAVAILABLE" }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  #buildRuntime(configuration: CloudflareConfiguration, provisioning: Extract<CloudflareProvisioningState, { provisioned: true }>): PilotRuntime {
    const clock = (): Date => new Date();
    const database = new DurableObjectSqlDatabase(this.ctx.storage);
    const unitRepository = new SqliteUnitRepository(database);
    const operatorRepository = new SqliteOperatorRepository(database, { clock });
    const receiptBlobs = new R2ReceiptBlobStore(this.env.RECEIPTS);
    // ADR 0075: SqliteTelemetry redacts before this observational sink; Workers Logs carry no secrets.
    const telemetrySink = (event: TelemetryEvent): void => {
      console.log(JSON.stringify({ event: "telemetry", ...event }));
    };

    // ADR 0087/0088: exactly as `startPilotServer` builds it — live Paystack (test in staging) bound to the origin.
    const paystackClient = new DirectPaystackClient(configuration.paystack);
    const expectedPaystackEnvironment = configuration.deployment === "staging" ? "test" : "live";
    if (paystackClient.configuration.environment !== expectedPaystackEnvironment || paystackClient.configuration.callbackBaseUrl !== configuration.publicOrigin) {
      throw new Error(
        configuration.deployment === "staging"
          ? "Pilot staging composition requires a test Paystack client bound to SHORTLET_PUBLIC_ORIGIN"
          : "Pilot production composition requires a live Paystack client bound to SHORTLET_PUBLIC_ORIGIN",
      );
    }
    // ADR 0099 rule 2: the host builds the platform Payments module once and passes it to the pack.
    const payments = new PaystackPayments({
      card: paystackClient,
      ...(configuration.paystackTransfersEnabled ? { transfers: new PaystackBankTransferClient(configuration.paystack, { clock }) } : {}),
    });

    const demoCheckIn = new Date(clock().getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const guestEnvironment = new LocalGuestEnvironment(
      {
        tenantId: configuration.tenantId,
        operatorId: provisioning.operatorId,
        operatorName: provisioning.operatorName,
        representativePersonId: "production-session-actor",
        representativePersonName: "Production Operator Representative",
        adminId: "production-operations",
        guestId: `guest-bootstrap-${crypto.randomUUID()}`,
        guestName: "Guest",
        initialGuestPhoneNumber: null,
        initialGuestContactEmail: null,
        demoCheckIn,
        production: true,
        deterministicPsp: false,
        clock,
        payments,
        // ADR 0090: manual transfer only when the business account is configured.
        manualTransferAccount: configuration.manualTransferAccount,
        ...(configuration.receiptMaxBytes === null ? {} : { receiptMaxBytes: configuration.receiptMaxBytes }),
      },
      { database, unitRepository, receiptBlobs, telemetrySink, guestData: platformGuestData(this.env, configuration.tenantId), guestDataIsRemote: true },
    );
    const operatorEnvironment = new LocalApartmentOwnerEnvironment(
      {
        tenantId: configuration.tenantId,
        operatorId: provisioning.operatorId,
        operatorName: provisioning.operatorName,
        representativePersonId: "production-session-actor",
        representativePersonName: "Production Operator Representative",
        adminId: "production-operations",
        unitId: provisioning.unitId,
        propertyId: provisioning.propertyId,
        seedFixture: false,
        production: true,
        clock,
      },
      { database, unitRepository, operatorRepository, receiptBlobs, telemetrySink, guestDataIsRemote: true },
    );

    const modelClient = createConciergeModelClient(configuration.concierge);
    const guest = createGuestRequestHandler({
      environment: guestEnvironment,
      assets: cloudflareAssetLoader,
      // Explicit, so production never falls back to reading CONCIERGE_MODE from the process environment.
      conciergeMode: configuration.concierge.mode,
      ...(modelClient ? { modelClient } : {}),
      ...(configuration.betaInviteCode === null ? {} : { betaInviteCode: configuration.betaInviteCode }),
      // ADR 0101: commerce data lives only in the commerce object, so the Shortlet object runs no commerce ledger or routes.
      commerce: GUEST_COMMERCE_COMPOSITION.disabled,
      production: true,
      publicOrigin: configuration.publicOrigin,
      secureCookie: true,
      sessionScopedGuestPrincipals: true,
      guestAccounts: {
        ...loadGuestAccountComposition({
          [GUEST_CODE_HASHING_KEY_ENV]: this.env.SHORTLET_GUEST_CODE_HASHING_KEY,
          RESEND_API_KEY: this.env.RESEND_API_KEY,
          SHORTLET_NOTIFICATION_FROM: this.env.SHORTLET_NOTIFICATION_FROM,
        }),
        ...platformGuestAccountDependencies(this.env, configuration.tenantId),
      },
      payments,
      modelCallBudget: new ModelCallBudget(configuration.limits.dailyModelCallCap, clock),
      sessionRuntimeIdleMs: configuration.limits.sessionRuntimeIdleMinutes * 60_000,
      // 04c: the user-approved production cap; the Durable Object has 128 MB of memory.
      sessionRuntimeLimit: configuration.sessionRuntimeLimit,
    });
    const owner = createOwnerRequestHandler({
      environment: operatorEnvironment,
      assets: cloudflareAssetLoader,
      production: true,
      publicOrigin: configuration.publicOrigin,
      secureCookie: true,
    });

    const notifier = configuration.notifications
        ? new PilotNotifier({
          database,
          guestData: platformGuestData(this.env, configuration.tenantId),
          publicOrigin: configuration.publicOrigin,
          sender: new ResendEmailSender({ apiKey: configuration.notifications.resendApiKey, from: configuration.notifications.from }),
          operatorAlertEmails: configuration.notifications.operatorAlertEmails,
          unitTitle: (unitId) => {
            const unit: unknown = unitRepository.findById(unitId);
            const title = unit !== null && typeof unit === "object" ? (unit as { title?: unknown }).title : undefined;
            return typeof title === "string" && title.trim() !== "" ? title : "your apartment";
          },
          clock,
        })
      : null;

    const handler = createPilotRequestHandler(configuration, {
      guest,
      owner,
      database,
      clock,
      // 09c: the edge's client address, read from the shim's node-shaped headers so the handler's rate limiters
      // keep their windows across requests.
      clientAddress: (req) => clientAddressFromCloudflareHeaderValue(req.headers["cf-connecting-ip"]),
      ready: () => true,
    });

    return { configuration, database, unitRepository, operatorRepository, handler, notifier };
  }

  /**
   * Replaces the Node notifier's `setInterval` (`pilot-server.ts`) and adds 12a's daily export. A task that throws
   * is isolated (do-alarm), and the alarm always reschedules itself, so one failed task cannot stop the next.
   */
  async alarm(): Promise<void> {
    const runtime = this.#alarmRuntime();
    const tasks: AlarmTask[] = [];
    // The notifier is null when notifications are not configured, exactly as Node's null notifier. Only the sweep is skipped.
    const notifier = runtime?.notifier ?? null;
    if (notifier !== null) tasks.push({ name: "notifications", run: async () => { await notifier.sweep(); } });
    // 12a: the export and orphan sweep run from the same alarm, whether or not notifications are configured.
    tasks.push({ name: "daily-export", run: async () => { await this.#dailyExport(); } });
    await runAlarmTasks(tasks, (line) => console.log(line));
    await this.ctx.storage.setAlarm(Date.now() + this.#alarmDelayMs(runtime));
  }

  /** Runs the export at most once per Lagos day (ADR 0078), tracked in Durable Object storage. */
  async #dailyExport(): Promise<void> {
    const today = lagosDate(new Date());
    if ((await this.ctx.storage.get<string>("export:lastDate")) === today) return;
    const configuration = loadExportConfiguration(this.env);
    await runDailyExport({
      database: new DurableObjectSqlDatabase(this.ctx.storage),
      receipts: this.env.RECEIPTS,
      exports: this.env.EXPORTS,
      clock: () => new Date(),
      retentionDays: configuration.retentionDays,
      orphanGraceHours: configuration.orphanGraceHours,
      tableOwner: "shortlet",
    });
    await this.ctx.storage.put("export:lastDate", today);
  }

  /**
   * The runtime for alarm work. After an eviction `#runtime` is empty until the next guest request, so the alarm builds it
   * when the object is provisioned. That keeps the notifier sweep on its cadence. Null when the object is not provisioned or
   * its configuration is invalid; the failure is logged, and the daily export still runs.
   */
  #alarmRuntime(): PilotRuntime | null {
    if (this.#runtime !== null) return this.#runtime;
    try {
      const configuration = loadCloudflareConfiguration(this.env);
      const provisioning = cloudflareProvisioningState(configuration, new DurableObjectSqlDatabase(this.ctx.storage));
      if (!provisioning.provisioned) return null;
      this.#runtime = this.#buildRuntime(configuration, provisioning);
      return this.#runtime;
    } catch (error) {
      console.log(JSON.stringify({ event: "alarm_runtime_unavailable", errorClass: error instanceof Error ? error.constructor.name : typeof error }));
      return null;
    }
  }

  /** The sweep cadence when notifications are configured, otherwise the daily cadence. */
  #alarmDelayMs(runtime: PilotRuntime | null): number {
    const sweepSeconds = runtime?.configuration.notifications?.sweepSeconds;
    return sweepSeconds === undefined ? DAILY_ALARM_MS : sweepSeconds * 1000;
  }

  /**
   * Schedules the alarm no later than the cadence the runtime needs. A stored alarm that is already sooner is kept, so an
   * alarm set on an ops request never delays the sweep once a guest runtime exists. Only a built runtime fixes the cadence,
   * so the flag is set then; before that each request checks the stored alarm.
   */
  async #ensureAlarm(runtime: PilotRuntime | null): Promise<void> {
    if (this.#alarmScheduled) return;
    const delayMs = this.#alarmDelayMs(runtime);
    const scheduled = await this.ctx.storage.getAlarm();
    if (scheduled === null || scheduled > Date.now() + delayMs) await this.ctx.storage.setAlarm(Date.now() + delayMs);
    if (runtime !== null) this.#alarmScheduled = true;
  }
}
