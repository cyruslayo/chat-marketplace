import { createHash } from "node:crypto";
import type { HttpRequestLike, HttpResponseHeaderValueOrList, HttpResponseLike } from "../../../packages/platform-core/src/http-like.js";
import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import { errorPage } from "../../web/src/ui-kit.js";
import type { PilotConfiguration } from "./pilot-config.js";
import { databaseHealthy } from "./database-health.js";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";

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
export type PilotHandlerConfiguration = Pick<PilotConfiguration, "publicOrigin" | "deployment" | "limits">;

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

interface CapturedHeader {
  readonly name: string;
  readonly value: HttpResponseHeaderValueOrList;
}

function lowerCase(name: string): string {
  return name.toLowerCase();
}

function contentTypeOf(headers: readonly CapturedHeader[]): string | null {
  const entry = [...headers].reverse().find((candidate) => lowerCase(candidate.name) === "content-type");
  const value = entry?.value;
  return typeof value === "string" ? value : null;
}

function contentEncodingOf(headers: readonly CapturedHeader[]): string | null {
  const entry = [...headers].reverse().find((candidate) => lowerCase(candidate.name) === "content-encoding");
  const value = entry?.value;
  return typeof value === "string" ? value : null;
}

/**
 * Staging only: captures the handler's HTML response and applies the beta banner to the complete page — the same
 * wrap the proxy applied by re-parsing a buffered body, with the content-length rewritten and `transfer-encoding`
 * dropped. JSON and assets pass through untouched, and a `HEAD` is never transformed.
 */
function bannerWrapped(
  inner: HttpResponseLike,
  method: string,
  transform: (html: string) => string,
): HttpResponseLike {
  const htmlResponse = (view: readonly CapturedHeader[]): boolean => {
    const contentType = contentTypeOf(view);
    return contentType !== null && /^text\/html\b/i.test(contentType) && contentEncodingOf(view) === null && method !== "HEAD";
  };
  let buffering = false;
  let capturedStatus = 0;
  let captured: CapturedHeader[] = [];
  const wrapped: HttpResponseLike = {
    get headersSent() {
      return inner.headersSent || buffering;
    },
    writeHead(statusCode, headers) {
      if (!buffering) {
        // The buffering decision is made from the handler's own written headers, not a re-parsed proxied body.
        const view = [...captured, ...Object.entries(headers ?? {}).map(([name, value]) => ({ name, value }))];
        if (!htmlResponse(view)) return inner.writeHead(statusCode, headers);
        buffering = true;
      }
      capturedStatus = statusCode;
      for (const [name, value] of Object.entries(headers ?? {})) captured.push({ name, value });
      return wrapped;
    },
    setHeader(name, value) {
      if (!buffering) return inner.setHeader(name, value);
      const lowered = lowerCase(name);
      captured = captured.filter((entry) => lowerCase(entry.name) !== lowered);
      captured.push({ name: lowered, value });
      return wrapped;
    },
    end(body) {
      if (!buffering) return inner.end(body);
      // Rewrite content-length and drop transfer-encoding exactly as the buffering proxy did.
      const source = body === undefined ? "" : Buffer.isBuffer(body) ? body.toString("utf8") : body;
      const bodyBytes = Buffer.from(transform(source), "utf8");
      const remaining = captured.filter((entry) => lowerCase(entry.name) !== "transfer-encoding" && lowerCase(entry.name) !== "content-length");
      // node:http accepts setHeader only before writeHead flushes, so the replay sets everything first.
      for (const entry of remaining) inner.setHeader(entry.name, entry.value);
      inner.setHeader("Content-Length", String(bodyBytes.length));
      inner.writeHead(capturedStatus, {});
      return inner.end(bodyBytes);
    },
    destroy(error) {
      return inner.destroy(error);
    },
  };
  return wrapped;
}

export function createPilotRequestHandler(
  configuration: PilotHandlerConfiguration,
  deps: PilotRequestHandlerDeps,
): PilotRequestHandler {
  const guard = requestGuard(configuration, deps.clock, deps.clientAddress);
  const transformHtml = configuration.deployment === "staging" ? withBetaBanner : undefined;

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
