import { createHash } from "node:crypto";
import type { HttpRequestLike, HttpResponseHeaderValueOrList, HttpResponseLike } from "../../../packages/platform-core/src/http-like.js";
import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import { errorPage } from "../../web/src/ui-kit.js";
import type { PilotConfiguration } from "./pilot-config.js";
import { databaseHealthy } from "./database-health.js";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";
import { bannerWrapped } from "../../local-guest/src/html-banner.js";

/** Staging marks every Guest and Operator page so nobody mistakes the beta for real bookings (issue 22). */
export const BETA_BANNER_TEXT = "Beta: test payments only. No real bookings are made.";
const BETA_BANNER_HTML = `<div role="note" data-beta-banner style="margin:0;padding:0.5rem 1rem;background:#fff4ce;color:#3d2f00;border-bottom:1px solid #d9b800;font:600 0.875rem/1.4 system-ui,sans-serif;text-align:center">${BETA_BANNER_TEXT}</div>`;

export function withBetaBanner(html: string): string {
  return html.replace(/<body\b[^>]*>/i, (body) => `${body}${BETA_BANNER_HTML}`);
}

/** The guest and owner handlers the pilot dispatches to in-process (slices 08a, 08b). */
export interface PilotDispatchTarget {
  handle(req: HttpRequestLike, res: HttpResponseLike): Promise<void>;
  close(): Promise<void>;
}

export interface PilotRequestHandlerDeps {
  /** The extracted Guest handler; every non-`/operator` request is dispatched to it. */
  readonly guest: PilotDispatchTarget;
  /** The extracted Operator handler; `/operator` and `/operator/*` are dispatched to it. */
  readonly owner: PilotDispatchTarget;
  /** ADR 0004: health comes from this one shared handle; no dispatch path opens a connection. */
  readonly database: SqlDatabase;
  readonly clock: () => Date;
  /** Injectable so the Workers shim (09c) can read `CF-Connecting-IP` and the Node version keeps its rule. */
  readonly clientAddress: (req: HttpRequestLike) => string;
  /** False until the Node wrapper is listening; `/healthz` answers 503 until then, as it did when proxying. */
  readonly ready: () => boolean;
}

export interface PilotRequestHandler {
  handle(req: HttpRequestLike, res: HttpResponseLike): Promise<void>;
  /** Closes the guest and owner handlers it dispatched to. The shared database is closed by the wrapper. */
  close(): Promise<void>;
}

/** Which handler record the handler actually uses; the rest of the configuration stays with the compositor. */
/** ADR 0105: `demo` is optional so the handler's existing configurations stay valid; the composition always sets it. */
export type PilotHandlerConfiguration = Pick<PilotConfiguration, "publicOrigin" | "deployment" | "limits"> & Partial<Pick<PilotConfiguration, "demo">>;

const GUEST_SESSION_COOKIE = "shortlet_guest_session";
const HOUR_MS = 60 * 60 * 1000;

function sendHealth(res: HttpResponseLike, healthy: boolean): void {
  res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ ok: healthy }));
}

function guestSessionKey(req: HttpRequestLike): string | null {
  const value = String(req.headers.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${GUEST_SESSION_COOKIE}=`))?.slice(GUEST_SESSION_COOKIE.length + 1);
  // Keyed by digest so raw session identifiers are not kept as limiter keys.
  return value ? createHash("sha256").update(value).digest("hex") : null;
}

/** Issue 19: refuses chat turns, new Guest sessions and Operator sign-ins beyond the configured hourly limits. */
function requestGuard(
  configuration: PilotHandlerConfiguration,
  clock: () => Date,
  clientAddress: (req: HttpRequestLike) => string,
): (req: HttpRequestLike, url: URL) => { readonly retryAfterSeconds: number } | null {
  const { limits } = configuration;
  const turnsPerSession = new SlidingWindowRateLimiter({ limit: limits.chatTurnsPerSessionPerHour, windowMs: HOUR_MS }, clock);
  const turnsPerAddress = new SlidingWindowRateLimiter({ limit: limits.chatTurnsPerAddressPerHour, windowMs: HOUR_MS }, clock);
  const sessionsPerAddress = new SlidingWindowRateLimiter({ limit: limits.newSessionsPerAddressPerHour, windowMs: HOUR_MS }, clock);
  const loginsPerAddress = new SlidingWindowRateLimiter({ limit: limits.operatorLoginsPerAddressPerHour, windowMs: HOUR_MS }, clock);
  return (req, url) => {
    const address = clientAddress(req);
    const refused = (result: ReturnType<SlidingWindowRateLimiter["tryConsume"]>) => result.allowed ? null : { retryAfterSeconds: result.retryAfterSeconds };
    // Issue 14: the landing composers' POST /welcome/start runs a first turn, so it is a chat turn; with no session cookie it also
    // starts a Guest session, which bounds new sessions (and invite-code guessing in staging) exactly as GET / does.
    const landingStart = req.method === "POST" && url.pathname === "/welcome/start";
    if (landingStart && guestSessionKey(req) === null) {
      const refusedSession = refused(sessionsPerAddress.tryConsume(address));
      if (refusedSession !== null) return refusedSession;
    }
    if (req.method === "POST" && (url.pathname === "/api/turn" || url.pathname === "/conversation" || landingStart)) {
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

function sendRateLimited(
  req: HttpRequestLike,
  res: HttpResponseLike,
  url: URL,
  retryAfterSeconds: number,
  transformHtml?: (html: string) => string,
): void {
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

export function createPilotRequestHandler(
  configuration: PilotHandlerConfiguration,
  deps: PilotRequestHandlerDeps,
): PilotRequestHandler {
  const guard = requestGuard(configuration, deps.clock, deps.clientAddress);
  // ADR 0105: in the demo the guest handler carries the demo banner on every guest page, so the beta banner is not added.
  const transformHtml = configuration.deployment === "staging" && !configuration.demo ? withBetaBanner : undefined;

  const dispatch = async (req: HttpRequestLike, res: HttpResponseLike): Promise<void> => {
    const url = new URL(req.url ?? "/", configuration.publicOrigin);
    if (req.method === "GET" && url.pathname === "/healthz") {
      sendHealth(res, deps.ready() && databaseHealthy(deps.database));
      return;
    }
    const refusal = guard(req, url);
    if (refusal) {
      sendRateLimited(req, res, url, refusal.retryAfterSeconds, transformHtml);
      return;
    }
    if (url.pathname === "/operator" || url.pathname.startsWith("/operator/")) {
      await deps.owner.handle(req, transformHtml ? bannerWrapped(res, req.method ?? "", transformHtml) : res);
      return;
    }
    await deps.guest.handle(req, transformHtml ? bannerWrapped(res, req.method ?? "", transformHtml) : res);
  };

  return {
    handle(req, res) {
      return dispatch(req, res);
    },
    close: async () => {
      await deps.owner.close();
      await deps.guest.close();
    },
  };
}
