import { DurableObject } from "cloudflare:workers";
import { DirectPaystackClient, PaystackBankTransferClient } from "../../../domains/shortlet/src/index.js";
import { SqliteOperatorRepository } from "../../../domains/shortlet/src/sqlite-operator-repository.js";
import { SqliteOperatorRepresentativeGrantStore } from "../../../domains/shortlet/src/operator-representative-authority.js";
import { SqliteOperatorSessionAuthority } from "../../../domains/shortlet/src/operator-session-authority.js";
import { SqliteUnitRepository } from "../../../domains/shortlet/src/sqlite-unit-repository.js";
import { SqliteAuditLog } from "../../../packages/platform-core/src/sqlite-audit-log.js";
import type { TelemetryEvent } from "../../../packages/platform-core/src/telemetry.js";
import { createConciergeModelClient } from "../../local-guest/src/assistant/concierge-configuration.js";
import { ModelCallBudget } from "../../local-guest/src/assistant/model-call-budget.js";
import { LocalGuestEnvironment } from "../../local-guest/src/fixture.js";
import { createGuestRequestHandler } from "../../local-guest/src/guest-server.js";
import { LocalApartmentOwnerEnvironment, createOwnerRequestHandler } from "../../local-owner/src/index.js";
import { ResendEmailSender } from "../../pilot/src/notifications/email-sender.js";
import { PilotNotifier } from "../../pilot/src/notifications/pilot-notifier.js";
import { createPilotRequestHandler, type PilotRequestHandler } from "../../pilot/src/pilot-request-handler.js";
import { DEFAULT_NOTIFICATION_SWEEP_SECONDS } from "../../pilot/src/pilot-config-core.js";
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
import { createOpsHandler, type OpsHandler } from "./ops-routes.js";
import { cloudflareAssetLoader } from "./pilot-assets.js";
import { R2ReceiptBlobStore } from "./r2-receipt-blob-store.js";

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

function isOpsPath(pathname: string): boolean {
  return pathname === OPS_PREFIX || pathname.startsWith(`${OPS_PREFIX}/`);
}

export class ShortletPilot extends DurableObject<CloudflareEnv> {
  #runtime: PilotRuntime | null = null;
  #opsHandler: OpsHandler | null = null;
  #alarmScheduled = false;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // 11a: authenticated ops routes are dispatched first, so provisioning does not depend on the guest/owner
    // configuration (Paystack, concierge) being valid, nor on the tenant being provisioned yet.
    if (isOpsPath(url.pathname)) return this.#handleOps(request);

    const database = new DurableObjectSqlDatabase(this.ctx.storage);
    let configuration: CloudflareConfiguration;
    let provisioning: CloudflareProvisioningState;
    try {
      configuration = loadCloudflareConfiguration(this.env);
      provisioning = cloudflareProvisioningState(configuration, database);
    } catch {
      // Fail closed without detail: a malformed configuration or inconsistent inventory is never served.
      return this.#unavailable();
    }

    // 10a's user-approved first boot: normal routes and health return 503 "not provisioned" until valid
    // tenant-matching inventory and operators exist; authenticated provisioning above stays available.
    if (!provisioning.provisioned) return this.#notProvisioned();

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
      sharedSecret: ops.sharedSecret,
      verifier: ops.verifier,
      operatorRepository: new SqliteOperatorRepository(database, { clock }),
      unitRepository: new SqliteUnitRepository(database),
      grantStore: new SqliteOperatorRepresentativeGrantStore(database, { clock }),
      sessionAuthority: new SqliteOperatorSessionAuthority(database, { clock }),
      audit: new SqliteAuditLog(database),
      clock,
      tenantId: this.env.SHORTLET_TENANT_ID?.trim() ?? "",
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
        paystackClient,
        // ADR 0088: Pay with Transfer only when explicitly enabled after certification.
        ...(configuration.paystackTransfersEnabled ? { bankTransferProvider: new PaystackBankTransferClient(configuration.paystack, { clock }) } : {}),
        // ADR 0090: manual transfer only when the business account is configured.
        manualTransferAccount: configuration.manualTransferAccount,
        ...(configuration.receiptMaxBytes === null ? {} : { receiptMaxBytes: configuration.receiptMaxBytes }),
      },
      { database, unitRepository, receiptBlobs, telemetrySink },
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
      { database, unitRepository, operatorRepository, receiptBlobs, telemetrySink },
    );

    const modelClient = createConciergeModelClient(configuration.concierge);
    const guest = createGuestRequestHandler({
      environment: guestEnvironment,
      assets: cloudflareAssetLoader,
      // Explicit, so production never falls back to reading CONCIERGE_MODE from the process environment.
      conciergeMode: configuration.concierge.mode,
      ...(modelClient ? { modelClient } : {}),
      ...(configuration.betaInviteCode === null ? {} : { betaInviteCode: configuration.betaInviteCode }),
      production: true,
      publicOrigin: configuration.publicOrigin,
      secureCookie: true,
      sessionScopedGuestPrincipals: true,
      paystackClient,
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
   * is isolated (do-alarm), and the alarm always reschedules itself, so one failed sweep cannot stop the next.
   */
  async alarm(): Promise<void> {
    const runtime = this.#runtime;
    const tasks: AlarmTask[] = [];
    if (runtime !== null) tasks.push(...this.#alarmTasks(runtime));
    // 12a: the export and orphan sweep run from the same alarm, whether or not the guest runtime is built.
    tasks.push({ name: "daily-export", run: async () => { await this.#dailyExport(); } });
    await runAlarmTasks(tasks, (line) => console.log(line));
    // The alarm always reschedules: the daily export must survive a guest runtime that is not built (for example,
    // before the tenant is provisioned).
    const sweepSeconds = runtime?.configuration.notifications?.sweepSeconds ?? DEFAULT_NOTIFICATION_SWEEP_SECONDS;
    const delayMs = runtime === null ? 24 * 60 * 60 * 1000 : sweepSeconds * 1000;
    await this.ctx.storage.setAlarm(Date.now() + delayMs);
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
    });
    await this.ctx.storage.put("export:lastDate", today);
  }

  #alarmTasks(runtime: PilotRuntime): readonly AlarmTask[] {
    const tasks: AlarmTask[] = [];
    const notifier = runtime.notifier;
    if (notifier !== null) tasks.push({ name: "notifications", run: async () => { await notifier.sweep(); } });
    return tasks;
  }

  async #ensureAlarm(runtime: PilotRuntime): Promise<void> {
    if (runtime.notifier === null || this.#alarmScheduled) return;
    this.#alarmScheduled = true;
    // The alarm survives eviction in storage, so only the first request after a fresh object schedules it.
    if ((await this.ctx.storage.getAlarm()) === null) await this.#scheduleAlarm(runtime);
  }

  async #scheduleAlarm(runtime: PilotRuntime): Promise<void> {
    if (runtime.notifier === null) return;
    const seconds = runtime.configuration.notifications?.sweepSeconds ?? DEFAULT_NOTIFICATION_SWEEP_SECONDS;
    await this.ctx.storage.setAlarm(Date.now() + seconds * 1000);
  }
}
