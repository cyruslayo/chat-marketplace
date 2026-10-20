import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { LocalGuestEnvironment } from "../../local-guest/src/fixture.js";
import {
  createGuestRequestHandler,
  GUEST_COMMERCE_COMPOSITION,
  type GuestRequestHandler,
} from "../../local-guest/src/guest-server.js";
import {
  LocalApartmentOwnerEnvironment,
  createOwnerRequestHandler,
} from "../../local-owner/src/index.js";
import { databaseHealthy } from "./database-health.js";
import { openNodeSqliteDatabase } from "../../../packages/platform-core/src/node-sqlite-database.js";
import { LOOPBACK_ADDRESS } from "../../../packages/platform-core/src/loopback-address.js";
import {
  JsonOperatorRepository,
  JsonUnitRepository,
} from "../../../domains/shortlet/src/index.js";
import {
  assertLocalPilotReady,
  LOCAL_PILOT_ACTOR_ID,
  LOCAL_PILOT_OPERATOR_ID,
  LOCAL_PILOT_OPERATOR_NAME,
  LOCAL_PILOT_PHOTO_HOST,
  LOCAL_PILOT_TENANT_ID,
  localPilotClock,
  localPilotPaths,
  type LocalPilotPaths,
} from "./local-pilot.js";

export interface LocalPilotServerHandle {
  readonly paths: LocalPilotPaths;
  listen(): Promise<number>;
  close(): Promise<void>;
}

export function startLocalPilotServer(
  options: { readonly port?: number; readonly paths?: LocalPilotPaths } = {},
): LocalPilotServerHandle {
  const paths = options.paths ?? localPilotPaths();
  assertLocalPilotReady(paths);
  const port = options.port ?? 3000;
  const publicOrigin = `http://${LOOPBACK_ADDRESS}:${port}`;
  // Local-only durable virtual clock starts within ADR-0042 Active Hours and advances with real elapsed time.
  const clock = localPilotClock(paths);
  const demoCheckIn = "2026-09-29";
  // ADR 0004: one SQLite handle and one inventory serve the Guest and Operator compositions in this process.
  const database = openNodeSqliteDatabase(paths.databasePath);
  const unitRepository = new JsonUnitRepository(paths.inventoryPath);
  const guestEnvironment = new LocalGuestEnvironment(
    {
      databasePath: paths.databasePath,
      inventoryPath: paths.inventoryPath,
      tenantId: LOCAL_PILOT_TENANT_ID,
      operatorId: LOCAL_PILOT_OPERATOR_ID,
      operatorName: LOCAL_PILOT_OPERATOR_NAME,
      representativePersonId: LOCAL_PILOT_ACTOR_ID,
      representativePersonName: "Local Pilot Representative",
      adminId: "admin-local-pilot",
      guestId: "guest-local-bootstrap",
      guestName: "Local Guest",
      initialGuestPhoneNumber: null,
      initialGuestContactEmail: null,
      demoCheckIn,
      ...(process.env.CONCIERGE_MODE === "gemini" ||
      process.env.CONCIERGE_MODE === "openai-compatible"
        ? { demoCheckOut: "2026-10-01" }
        : {}),
      production: false,
      deterministicPsp: true,
      seedRepresentativeGrant: false,
      clock,
      // Local pilot only: a clearly fictional business account so manual transfer can be walked through (ADR 0090).
      manualTransferAccount: {
        bankName: "Local Demo Bank",
        accountName: "Shortlet Local Demo",
        accountNumber: "0000000000",
      },
    },
    { database, unitRepository },
  );
  const operatorEnvironment = new LocalApartmentOwnerEnvironment(
    {
      databasePath: paths.databasePath,
      inventoryPath: paths.inventoryPath,
      operatorsPath: paths.operatorsPath,
      tenantId: LOCAL_PILOT_TENANT_ID,
      operatorId: LOCAL_PILOT_OPERATOR_ID,
      operatorName: LOCAL_PILOT_OPERATOR_NAME,
      representativePersonId: LOCAL_PILOT_ACTOR_ID,
      representativePersonName: "Local Pilot Representative",
      adminId: "admin-local-pilot",
      unitId: "unit-local-abuja-wuse2",
      propertyId: "property-local-abuja-wuse2",
      seedFixture: false,
      clock,
    },
    {
      database,
      unitRepository,
      operatorRepository: new JsonOperatorRepository(paths.operatorsPath, {
        clock,
      }),
    },
  );
  const guest = createGuestRequestHandler({
    // ADR 0099: pilot hosts compose stays only; the separate local demo keeps its default.
    commerce: GUEST_COMMERCE_COMPOSITION.disabled,
    environment: guestEnvironment,
    production: false,
    fixtureRoutes: false,
    publicOrigin,
    secureCookie: false,
    sessionScopedGuestPrincipals: true,
    localPayment: true,
    localPhotoUrl: (url) =>
      url.startsWith(`${LOCAL_PILOT_PHOTO_HOST}/photos/`)
        ? url.slice(LOCAL_PILOT_PHOTO_HOST.length)
        : url,
  });
  const owner = createOwnerRequestHandler({
    environment: operatorEnvironment,
    production: true,
    publicOrigin,
    secureCookie: false,
  });
  let initialized = false;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", publicOrigin);
    if (req.method === "GET" && url.pathname === "/healthz") {
      const ok = initialized && databaseHealthy(guestEnvironment.database);
      res.writeHead(ok ? 200 : 503, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ ok }));
      return;
    }
    const photo = /^\/photos\/([a-z0-9-]+\.svg)$/.exec(url.pathname);
    if (req.method === "GET" && photo) {
      res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end("No approved local property photo is bundled with this pilot.");
      return;
    }
    void (
      url.pathname === "/operator" || url.pathname.startsWith("/operator/")
        ? owner
        : guest
    )
      .handle(req, res)
      .catch(() => {
        if (!res.headersSent) {
          res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Local pilot service unavailable");
        }
      });
  });
  return {
    paths,
    listen: async () => {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, LOOPBACK_ADDRESS, resolve);
      });
      initialized = true;
      const address = server.address();
      return typeof address === "object" && address ? address.port : port;
    },
    close: async () => {
      initialized = false;
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await owner.close();
      await guest.close();
      database.close();
    },
  };
}
