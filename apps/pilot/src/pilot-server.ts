import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { LocalGuestEnvironment } from "../../local-guest/src/fixture.js";
import { startLocalGuestServer, type LocalGuestServerHandle } from "../../local-guest/src/guest-server.js";
import { LocalApartmentOwnerEnvironment, startLocalOwnerServer } from "../../local-owner/src/index.js";
import { DirectPaystackClient, type PaystackClient } from "../../../domains/shortlet/src/index.js";
import { loadPilotConfiguration, type PilotConfiguration } from "./pilot-config.js";

export interface PilotServerHandle {
  readonly port: number;
  readonly configuration: PilotConfiguration;
  readonly guest: LocalGuestServerHandle;
  listen(): Promise<number>;
  close(): Promise<void>;
}

function healthCheck(configuration: PilotConfiguration): { readonly ok: true } | { readonly ok: false } {
  try {
    const database = new DatabaseSync(configuration.databasePath);
    database.prepare("SELECT 1").get();
    database.close();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

function sendHealth(res: ServerResponse, configuration: PilotConfiguration, initialized: boolean): void {
  const healthy = initialized && healthCheck(configuration).ok;
  res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ ok: healthy }));
}

function proxyRequest(req: IncomingMessage, res: ServerResponse, port: number): void {
  const upstream = httpRequest({
    hostname: "127.0.0.1",
    port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${port}` },
  }, (upstreamResponse) => {
    res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(res);
  });
  upstream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Pilot service unavailable");
    }
  });
  req.pipe(upstream);
}

export function startPilotServer(options: {
  readonly port?: number;
  readonly configuration?: PilotConfiguration;
  readonly clock?: () => Date;
  /** Test harnesses may inject a provider-shaped fake, never a deterministic PSP fallback. */
  readonly paystackClient?: PaystackClient;
} = {}): PilotServerHandle {
  const configuration = options.configuration ?? loadPilotConfiguration();
  const paystackClient = options.paystackClient ?? new DirectPaystackClient(configuration.paystack);
  const clock = options.clock ?? (() => new Date());
  const demoCheckIn = new Date(clock().getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (paystackClient.configuration.environment !== "live" || paystackClient.configuration.callbackBaseUrl !== configuration.publicOrigin) {
    throw new Error("Pilot production composition requires a live Paystack client bound to SHORTLET_PUBLIC_ORIGIN");
  }

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
    paystackClient,
  });
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
    clock,
  });

  const guest = startLocalGuestServer({
    port: 0,
    environment: guestEnvironment,
    production: true,
    publicOrigin: configuration.publicOrigin,
    secureCookie: true,
    sessionScopedGuestPrincipals: true,
    paystackClient,
  });
  const owner = startLocalOwnerServer({
    port: 0,
    environment: operatorEnvironment,
    production: true,
    publicOrigin: configuration.publicOrigin,
    secureCookie: true,
  });

  let guestPort = 0;
  let ownerPort = 0;
  let initialized = false;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", configuration.publicOrigin);
    if (req.method === "GET" && url.pathname === "/healthz") {
      sendHealth(res, configuration, initialized);
      return;
    }
    if (url.pathname === "/operator" || url.pathname.startsWith("/operator/")) {
      proxyRequest(req, res, ownerPort);
      return;
    }
    proxyRequest(req, res, guestPort);
  });

  return {
    port: options.port ?? 0,
    configuration,
    guest,
    listen: async () => {
      guestPort = await guest.listen();
      ownerPort = await owner.listen();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
      });
      initialized = true;
      const address = server.address();
      return typeof address === "object" && address ? address.port : options.port ?? 0;
    },
    close: async () => {
      initialized = false;
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await owner.close();
      await guest.close();
    },
  };
}
