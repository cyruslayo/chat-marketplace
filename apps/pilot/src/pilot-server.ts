import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { LocalGuestEnvironment } from "../../local-guest/src/fixture.js";
import { startLocalGuestServer, type LocalGuestServerHandle } from "../../local-guest/src/guest-server.js";
import { LocalApartmentOwnerEnvironment, startLocalOwnerServer } from "../../local-owner/src/index.js";
import { DirectPaystackClient, PaystackBankTransferClient, type PaystackClient } from "../../../domains/shortlet/src/index.js";
import { loadPilotConfiguration, type PilotConfiguration } from "./pilot-config.js";
import type { AssistantModelClient } from "../../local-guest/src/assistant/assistant-model.js";
import { createConciergeModelClient } from "../../local-guest/src/assistant/concierge-configuration.js";
import { ModelCallBudget } from "../../local-guest/src/assistant/model-call-budget.js";
import { errorPage } from "../../web/src/ui-kit.js";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";

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

/** Staging marks every Guest and Operator page so nobody mistakes the beta for real bookings (issue 22). */
export const BETA_BANNER_TEXT = "Beta: test payments only. No real bookings are made.";
const BETA_BANNER_HTML = `<div role="note" data-beta-banner style="margin:0;padding:0.5rem 1rem;background:#fff4ce;color:#3d2f00;border-bottom:1px solid #d9b800;font:600 0.875rem/1.4 system-ui,sans-serif;text-align:center">${BETA_BANNER_TEXT}</div>`;

export function withBetaBanner(html: string): string {
  return html.replace(/<body\b[^>]*>/i, (body) => `${body}${BETA_BANNER_HTML}`);
}

function proxyRequest(req: IncomingMessage, res: ServerResponse, port: number, transformHtml?: (html: string) => string): void {
  const upstream = httpRequest({
    hostname: "127.0.0.1",
    port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${port}` },
  }, (upstreamResponse) => {
    const status = upstreamResponse.statusCode ?? 502;
    const isHtml = /^text\/html\b/i.test(String(upstreamResponse.headers["content-type"] ?? ""));
    if (!transformHtml || !isHtml || req.method === "HEAD" || upstreamResponse.headers["content-encoding"]) {
      res.writeHead(status, upstreamResponse.headers);
      upstreamResponse.pipe(res);
      return;
    }
    const chunks: Buffer[] = [];
    upstreamResponse.on("data", (chunk: Buffer) => chunks.push(chunk));
    upstreamResponse.on("end", () => {
      const body = Buffer.from(transformHtml(Buffer.concat(chunks).toString("utf8")), "utf8");
      const headers = { ...upstreamResponse.headers, "content-length": String(body.length) };
      delete headers["transfer-encoding"];
      res.writeHead(status, headers);
      res.end(body);
    });
    upstreamResponse.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end();
    });
  });
  upstream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Pilot service unavailable");
    }
  });
  req.pipe(upstream);
}

const GUEST_SESSION_COOKIE = "shortlet_guest_session";
const HOUR_MS = 60 * 60 * 1000;

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

function guestSessionKey(req: IncomingMessage): string | null {
  const value = String(req.headers.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${GUEST_SESSION_COOKIE}=`))?.slice(GUEST_SESSION_COOKIE.length + 1);
  // Keyed by digest so raw session identifiers are not kept as limiter keys.
  return value ? createHash("sha256").update(value).digest("hex") : null;
}

/** Issue 19: refuses chat turns, new Guest sessions and Operator sign-ins beyond the configured hourly limits. */
function requestGuard(configuration: PilotConfiguration, clock: () => Date): (req: IncomingMessage, url: URL) => { readonly retryAfterSeconds: number } | null {
  const { limits } = configuration;
  const turnsPerSession = new SlidingWindowRateLimiter({ limit: limits.chatTurnsPerSessionPerHour, windowMs: HOUR_MS }, clock);
  const turnsPerAddress = new SlidingWindowRateLimiter({ limit: limits.chatTurnsPerAddressPerHour, windowMs: HOUR_MS }, clock);
  const sessionsPerAddress = new SlidingWindowRateLimiter({ limit: limits.newSessionsPerAddressPerHour, windowMs: HOUR_MS }, clock);
  const loginsPerAddress = new SlidingWindowRateLimiter({ limit: limits.operatorLoginsPerAddressPerHour, windowMs: HOUR_MS }, clock);
  return (req, url) => {
    const address = clientAddress(req);
    const refused = (result: ReturnType<SlidingWindowRateLimiter["tryConsume"]>) => result.allowed ? null : { retryAfterSeconds: result.retryAfterSeconds };
    if (req.method === "POST" && (url.pathname === "/api/turn" || url.pathname === "/conversation")) {
      // Both limits are checked before either is charged, so a refused turn uses up neither allowance.
      const session = guestSessionKey(req);
      const waits = [turnsPerAddress.retryAfterSeconds(address), session ? turnsPerSession.retryAfterSeconds(session) : null]
        .filter((wait): wait is number => wait !== null);
      if (waits.length > 0) return { retryAfterSeconds: Math.max(...waits) };
      turnsPerAddress.record(address);
      if (session) turnsPerSession.record(session);
      return null;
    }
    // A new Guest session starts at GET / without a session cookie; in staging this also bounds invite-code guessing.
    if (req.method === "GET" && url.pathname === "/" && guestSessionKey(req) === null) return refused(sessionsPerAddress.tryConsume(address));
    if (req.method === "POST" && url.pathname === "/operator/login") return refused(loginsPerAddress.tryConsume(address));
    return null;
  };
}

function sendRateLimited(req: IncomingMessage, res: ServerResponse, url: URL, retryAfterSeconds: number, transformHtml?: (html: string) => string): void {
  req.resume();
  const headers = { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" };
  if (url.pathname.startsWith("/api/")) {
    res.writeHead(429, { ...headers, "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, code: "RATE_LIMITED", message: "Too many requests. Please wait a moment and try again." }));
    return;
  }
  const html = errorPage({ status: 429, code: "RATE_LIMITED", title: "Please slow down", message: "Too many requests came from here in a short time. Wait a few minutes, then try again.", action: { href: url.pathname.startsWith("/operator") ? "/operator/login" : "/", label: "Try again" } });
  res.writeHead(429, { ...headers, "Content-Type": "text/html; charset=utf-8" });
  res.end(transformHtml ? transformHtml(html) : html);
}

export function startPilotServer(options: {
  readonly port?: number;
  readonly configuration?: PilotConfiguration;
  readonly clock?: () => Date;
  /** Test harnesses may inject a provider-shaped fake, never a deterministic PSP fallback. */
  readonly paystackClient?: PaystackClient;
  /** Test harnesses may inject a provider-shaped fake model client in place of the configured provider. */
  readonly modelClient?: AssistantModelClient;
} = {}): PilotServerHandle {
  const configuration = options.configuration ?? loadPilotConfiguration();
  const paystackClient = options.paystackClient ?? new DirectPaystackClient(configuration.paystack);
  const clock = options.clock ?? (() => new Date());
  const demoCheckIn = new Date(clock().getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // Production takes only live Paystack; staging (the closed beta) takes only test Paystack (issue 22).
  const expectedPaystackEnvironment = configuration.deployment === "staging" ? "test" : "live";
  if (paystackClient.configuration.environment !== expectedPaystackEnvironment || paystackClient.configuration.callbackBaseUrl !== configuration.publicOrigin) {
    throw new Error(configuration.deployment === "staging"
      ? "Pilot staging composition requires a test Paystack client bound to SHORTLET_PUBLIC_ORIGIN"
      : "Pilot production composition requires a live Paystack client bound to SHORTLET_PUBLIC_ORIGIN");
  }
  const transformHtml = configuration.deployment === "staging" ? withBetaBanner : undefined;

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
    // ADR 0088: Pay with Transfer only when explicitly enabled after certification.
    ...(configuration.paystackTransfersEnabled ? { bankTransferProvider: new PaystackBankTransferClient(configuration.paystack, { clock }) } : {}),
    // ADR 0090: manual transfer only when the business account is configured.
    manualTransferAccount: configuration.manualTransferAccount,
    ...(configuration.receiptMaxBytes === null ? {} : { receiptMaxBytes: configuration.receiptMaxBytes }),
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

  const modelClient = options.modelClient ?? createConciergeModelClient(configuration.concierge);
  const guest = startLocalGuestServer({
    port: 0,
    environment: guestEnvironment,
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
  });
  const owner = startLocalOwnerServer({
    port: 0,
    environment: operatorEnvironment,
    production: true,
    publicOrigin: configuration.publicOrigin,
    secureCookie: true,
  });

  const guard = requestGuard(configuration, clock);

  let guestPort = 0;
  let ownerPort = 0;
  let initialized = false;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", configuration.publicOrigin);
    if (req.method === "GET" && url.pathname === "/healthz") {
      sendHealth(res, configuration, initialized);
      return;
    }
    const refusal = guard(req, url);
    if (refusal) {
      sendRateLimited(req, res, url, refusal.retryAfterSeconds, transformHtml);
      return;
    }
    if (url.pathname === "/operator" || url.pathname.startsWith("/operator/")) {
      proxyRequest(req, res, ownerPort, transformHtml);
      return;
    }
    proxyRequest(req, res, guestPort, transformHtml);
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
