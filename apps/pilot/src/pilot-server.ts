import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { LocalGuestEnvironment } from "../../local-guest/src/fixture.js";
import { createGuestRequestHandler, type GuestRequestHandler } from "../../local-guest/src/guest-server.js";
import { LocalApartmentOwnerEnvironment, createOwnerRequestHandler } from "../../local-owner/src/index.js";
import { JsonOperatorRepository, JsonUnitRepository } from "../../../domains/shortlet/src/index.js";
import { DirectPaystackClient, PaystackBankTransferClient, PaystackPayments, type PaystackClient, type Payments } from "../../../packages/platform-core/src/payments/index.js";
import { loadPilotConfiguration, type PilotConfiguration } from "./pilot-config.js";
import type { AssistantModelClient } from "../../local-guest/src/assistant/assistant-model.js";
import { createConciergeModelClient } from "../../local-guest/src/assistant/concierge-configuration.js";
import { ModelCallBudget } from "../../local-guest/src/assistant/model-call-budget.js";
import { ResendEmailSender, type EmailSender } from "./notifications/email-sender.js";
import { PilotNotifier } from "./notifications/pilot-notifier.js";
import { openNodeSqliteDatabase } from "../../../packages/platform-core/src/node-sqlite-database.js";
import { LOOPBACK_ADDRESS } from "../../../packages/platform-core/src/loopback-address.js";
import { createPilotRequestHandler } from "./pilot-request-handler.js";

export { BETA_BANNER_TEXT, withBetaBanner } from "./pilot-request-handler.js";

export interface PilotServerHandle {
  readonly port: number;
  readonly configuration: PilotConfiguration;
  readonly guest: GuestRequestHandler;
  /** Issue 23: null when notifications are not configured. */
  readonly notifier: PilotNotifier | null;
  listen(): Promise<number>;
  close(): Promise<void>;
}

/**
 * The address the request came from. The pilot listens on loopback behind the HTTPS reverse proxy
 * (docs/pilot-deployment.md), which appends the client address to X-Forwarded-For; the rightmost entry is the one
 * the proxy saw, so a client cannot choose its own key by sending the header.
 */
export function clientAddress(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const header = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
  const last = header?.split(",").map((part) => part.trim()).filter((part) => part !== "").at(-1);
  return last ?? req.socket.remoteAddress ?? "unknown";
}

export function startPilotServer(options: {
  readonly port?: number;
  readonly configuration?: PilotConfiguration;
  readonly clock?: () => Date;
  /** Test harnesses may inject a provider-shaped fake, never a deterministic PSP fallback. */
  readonly paystackClient?: PaystackClient;
  /** The platform Payments module, so a host composes it once (ADR 0099 rule 2). Built from the client when absent. */
  readonly payments?: Payments;
  /** Test harnesses may inject a provider-shaped fake model client in place of the configured provider. */
  readonly modelClient?: AssistantModelClient;
  /** Test harnesses may inject a fake email sender in place of Resend; notifications must still be configured. */
  readonly emailSender?: EmailSender;
} = {}): PilotServerHandle {
  const configuration = options.configuration ?? loadPilotConfiguration();
  // ADR 0099 rule 2: the host builds the platform Payments module once and passes it to the pack.
  const paystackClient = options.paystackClient ?? new DirectPaystackClient(configuration.paystack);
  const clock = options.clock ?? (() => new Date());
  const payments = options.payments ?? new PaystackPayments({
    card: paystackClient,
    // ADR 0088: Pay with Transfer only when explicitly enabled after certification.
    ...(configuration.paystackTransfersEnabled ? { transfers: new PaystackBankTransferClient(configuration.paystack, { clock }) } : {}),
  });
  const demoCheckIn = new Date(clock().getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // Production takes only live Paystack; staging (the closed beta) takes only test Paystack (issue 22).
  const expectedPaystackEnvironment = configuration.deployment === "staging" ? "test" : "live";
  if (paystackClient.configuration.environment !== expectedPaystackEnvironment || paystackClient.configuration.callbackBaseUrl !== configuration.publicOrigin) {
    throw new Error(configuration.deployment === "staging"
      ? "Pilot staging composition requires a test Paystack client bound to SHORTLET_PUBLIC_ORIGIN"
      : "Pilot production composition requires a live Paystack client bound to SHORTLET_PUBLIC_ORIGIN");
  }

  // ADR 0004: one SQLite handle and one inventory serve the Guest and Operator compositions in this process.
  const database = openNodeSqliteDatabase(configuration.databasePath);
  const unitRepository = new JsonUnitRepository(configuration.inventoryPath);
  const guestEnvironment = new LocalGuestEnvironment({
    databasePath: configuration.databasePath,
    inventoryPath: configuration.inventoryPath,
    tenantId: configuration.tenantId,
    operatorId: configuration.operatorId,
    operatorName: configuration.operatorName,
    representativePersonId: "production-session-actor",
    representativePersonName: "Production Operator Representative",
    adminId: "production-operations",
    guestId: `guest-bootstrap-${randomUUID()}`,
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
  }, { database, unitRepository });
  const operatorEnvironment = new LocalApartmentOwnerEnvironment({
    databasePath: configuration.databasePath,
    inventoryPath: configuration.inventoryPath,
    operatorsPath: configuration.operatorsPath,
    tenantId: configuration.tenantId,
    operatorId: configuration.operatorId,
    operatorName: configuration.operatorName,
    representativePersonId: "production-session-actor",
    representativePersonName: "Production Operator Representative",
    adminId: "production-operations",
    unitId: configuration.unitId,
    propertyId: configuration.propertyId,
    seedFixture: false,
    production: true,
    clock,
  }, { database, unitRepository, operatorRepository: new JsonOperatorRepository(configuration.operatorsPath, { clock }) });

  const modelClient = options.modelClient ?? createConciergeModelClient(configuration.concierge);
  const guest = createGuestRequestHandler({
    environment: guestEnvironment,
    // Explicit, so production never falls back to reading CONCIERGE_MODE from the process environment.
    conciergeMode: configuration.concierge.mode,
    ...(modelClient ? { modelClient } : {}),
    ...(configuration.betaInviteCode === null ? {} : { betaInviteCode: configuration.betaInviteCode }),
    production: true,
    publicOrigin: configuration.publicOrigin,
    secureCookie: true,
    sessionScopedGuestPrincipals: true,
    payments,
    modelCallBudget: new ModelCallBudget(configuration.limits.dailyModelCallCap, clock),
    sessionRuntimeIdleMs: configuration.limits.sessionRuntimeIdleMinutes * 60_000,
  });
  const owner = createOwnerRequestHandler({
    environment: operatorEnvironment,
    production: true,
    publicOrigin: configuration.publicOrigin,
    secureCookie: true,
  });

  // Issue 23: email notifications, swept from durable state on an interval once the server is listening.
  const notifier = configuration.notifications
    ? new PilotNotifier({
      database: guestEnvironment.database,
      publicOrigin: configuration.publicOrigin,
      sender: options.emailSender ?? new ResendEmailSender({ apiKey: configuration.notifications.resendApiKey, from: configuration.notifications.from }),
      operatorAlertEmails: configuration.notifications.operatorAlertEmails,
      unitTitle: (unitId) => {
        const unit: unknown = guestEnvironment.unitRepository.findById(unitId);
        const title = unit !== null && typeof unit === "object" ? (unit as { title?: unknown }).title : undefined;
        return typeof title === "string" && title.trim() !== "" ? title : "your apartment";
      },
      clock,
    })
    : null;
  let notificationTimer: ReturnType<typeof setInterval> | null = null;
  let inFlightSweep: Promise<unknown> = Promise.resolve();
  let initialized = false;

  const pilot = createPilotRequestHandler(configuration, {
    guest,
    owner,
    database: guestEnvironment.database,
    clock,
    clientAddress: (req) => clientAddress(req as IncomingMessage),
    ready: () => initialized,
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void pilot.handle(req, res).catch(() => {
      if (!res.headersSent) { res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Pilot service unavailable"); }
      else res.destroy();
    });
  });

  return {
    port: options.port ?? 0,
    configuration,
    guest,
    notifier,
    listen: async () => {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port ?? 0, LOOPBACK_ADDRESS, () => resolve());
      });
      initialized = true;
      if (notifier && configuration.notifications) {
        notificationTimer = setInterval(() => { inFlightSweep = notifier.sweep(); }, configuration.notifications.sweepSeconds * 1000);
        notificationTimer.unref();
      }
      const address = server.address();
      return typeof address === "object" && address ? address.port : options.port ?? 0;
    },
    close: async () => {
      initialized = false;
      if (notificationTimer) clearInterval(notificationTimer);
      await inFlightSweep;
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await pilot.close();
      database.close();
    },
  };
}
