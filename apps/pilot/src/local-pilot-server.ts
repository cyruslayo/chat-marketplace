import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { LocalGuestEnvironment } from "../../local-guest/src/fixture.js";
import { startLocalGuestServer } from "../../local-guest/src/guest-server.js";
import { LocalApartmentOwnerEnvironment, startLocalOwnerServer } from "../../local-owner/src/index.js";
import { assertLocalPilotReady, LOCAL_PILOT_ACTOR_ID, LOCAL_PILOT_OPERATOR_ID, LOCAL_PILOT_OPERATOR_NAME, LOCAL_PILOT_PHOTO_HOST, LOCAL_PILOT_TENANT_ID, localPilotClock, localPilotPaths, type LocalPilotPaths } from "./local-pilot.js";

export interface LocalPilotServerHandle {
  readonly paths: LocalPilotPaths;
  listen(): Promise<number>;
  close(): Promise<void>;
}

function proxyRequest(req: IncomingMessage, res: ServerResponse, port: number): void {
  const upstream = httpRequest({ hostname: "127.0.0.1", port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (upstreamResponse) => {
    res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(res);
  });
  upstream.on("error", () => { if (!res.headersSent) { res.writeHead(503); res.end("Local pilot service unavailable"); } });
  req.pipe(upstream);
}

function syntheticPhoto(name: string): string {
  const abuja = name.startsWith("wuse");
  const bedroom = name.includes("bedroom");
  const background = abuja ? "#d8c7aa" : "#b8c8bb";
  const accent = abuja ? "#8c5838" : "#315c4b";
  const area = abuja ? "Wuse 2, Abuja" : name.startsWith("lekki") ? "Lekki Phase 1, Lagos" : "Old Ikoyi, Lagos";
  const label = `${area} — ${bedroom ? "Bedroom" : "Living room"}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900"><rect width="1200" height="900" fill="${background}"/><rect x="85" y="105" width="1030" height="650" rx="28" fill="#f8f4ea"/><rect x="145" y="180" width="430" height="400" rx="18" fill="${accent}" opacity=".82"/><rect x="635" y="210" width="390" height="250" rx="18" fill="#e4d7c4"/><circle cx="830" cy="585" r="92" fill="${accent}" opacity=".45"/><text x="600" y="820" text-anchor="middle" font-family="system-ui,sans-serif" font-size="42" fill="#26352e">${label}</text></svg>`;
}

export function startLocalPilotServer(options: { readonly port?: number; readonly paths?: LocalPilotPaths } = {}): LocalPilotServerHandle {
  const paths = options.paths ?? localPilotPaths();
  assertLocalPilotReady(paths);
  const port = options.port ?? 3000;
  const publicOrigin = `http://127.0.0.1:${port}`;
  // Local-only durable virtual clock starts within ADR-0042 Active Hours and advances with real elapsed time.
  const clock = localPilotClock(paths);
  const demoCheckIn = "2026-09-29";
  const guestEnvironment = new LocalGuestEnvironment({
    databasePath: paths.databasePath, inventoryPath: paths.inventoryPath, tenantId: LOCAL_PILOT_TENANT_ID,
    operatorId: LOCAL_PILOT_OPERATOR_ID, operatorName: LOCAL_PILOT_OPERATOR_NAME, representativePersonId: LOCAL_PILOT_ACTOR_ID,
    representativePersonName: "Local Pilot Representative", adminId: "admin-local-pilot", guestId: "guest-local-bootstrap",
    guestName: "Local Guest", initialGuestPhoneNumber: null, initialGuestContactEmail: null, demoCheckIn,
    ...(process.env.CONCIERGE_MODE === "gemini" ? { demoCheckOut: "2026-10-01" } : {}), production: false,
    deterministicPsp: true, seedRepresentativeGrant: false, clock,
  });
  const operatorEnvironment = new LocalApartmentOwnerEnvironment({
    databasePath: paths.databasePath, inventoryPath: paths.inventoryPath, operatorsPath: paths.operatorsPath,
    tenantId: LOCAL_PILOT_TENANT_ID, operatorId: LOCAL_PILOT_OPERATOR_ID, operatorName: LOCAL_PILOT_OPERATOR_NAME,
    representativePersonId: LOCAL_PILOT_ACTOR_ID, representativePersonName: "Local Pilot Representative", adminId: "admin-local-pilot",
    unitId: "unit-local-abuja-wuse2", propertyId: "property-local-abuja-wuse2", seedFixture: false, clock,
  });
  const guest = startLocalGuestServer({
    port: 0, environment: guestEnvironment, production: false, fixtureRoutes: false, publicOrigin, secureCookie: false,
    sessionScopedGuestPrincipals: true, localPayment: true,
    localPhotoUrl: (url) => url.startsWith(`${LOCAL_PILOT_PHOTO_HOST}/photos/`) ? url.slice(LOCAL_PILOT_PHOTO_HOST.length) : url,
  });
  const owner = startLocalOwnerServer({ port: 0, environment: operatorEnvironment, production: true, publicOrigin, secureCookie: false });
  let guestPort = 0;
  let ownerPort = 0;
  let initialized = false;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", publicOrigin);
    if (req.method === "GET" && url.pathname === "/healthz") {
      let ok = initialized;
      try { const database = new DatabaseSync(paths.databasePath); database.prepare("SELECT 1").get(); database.close(); } catch { ok = false; }
      res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify({ ok })); return;
    }
    const photo = /^\/photos\/([a-z0-9-]+\.svg)$/.exec(url.pathname);
    if (req.method === "GET" && photo) { res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" }); res.end(syntheticPhoto(photo[1]!)); return; }
    if (url.pathname === "/operator" || url.pathname.startsWith("/operator/")) { proxyRequest(req, res, ownerPort); return; }
    proxyRequest(req, res, guestPort);
  });
  return {
    paths,
    listen: async () => {
      guestPort = await guest.listen(); ownerPort = await owner.listen();
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
      initialized = true;
      const address = server.address(); return typeof address === "object" && address ? address.port : port;
    },
    close: async () => {
      initialized = false; server.closeIdleConnections?.(); server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await owner.close(); await guest.close();
    },
  };
}
