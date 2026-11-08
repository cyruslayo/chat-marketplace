import type { Request as WorkerRequest, Response as WorkerResponse } from "@cloudflare/workers-types";
import type { CloudflareEnv } from "./cloudflare-config.js";

export { ShortletPilot } from "./shortlet-pilot-do.js";
export { PlatformDO } from "./platform-do.js";
export { CommerceMarket } from "./commerce-market-do.js";

/** Account/session and thread ownership routes terminate at the platform authority (ADR 0101). */
export function isPlatformPath(pathname: string): boolean {
  return pathname === "/account" || pathname.startsWith("/account/") ||
    pathname === "/api/threads" || pathname.startsWith("/api/threads/") ||
    pathname === "/threads" || pathname.startsWith("/threads/");
}

/** The commerce API is never public; it is refused here so no authority receives the request (issue 24 decision). */
export function isCommerceApiPath(pathname: string): boolean {
  return pathname === "/api/commerce" || pathname.startsWith("/api/commerce/");
}

export const HTTP_REQUEST_LOG_EVENT = "http_request";
export const UNHANDLED_REJECTION_LOG_EVENT = "unhandled_rejection";

/**
 * Known dynamic routes collapse to their template, so a request log groups by route and never carries an id
 * (pilot issue 24: route template only, no query values or body). An unknown path falls back to per-segment
 * redaction, so a UUID or long opaque id cannot slip into the line (ADR 0075).
 */
const ROUTE_TEMPLATES: readonly (readonly [RegExp, string])[] = [
  [/^\/operator\/requests\/[^/]+\/(?:confirm|decline)$/, "/operator/requests/:id/:action"],
  [/^\/operator\/requests\/[^/]+$/, "/operator/requests/:id"],
  [/^\/operator\/bookings\/[^/]+\/blocking-complaint\/[^/]+\/(?:dismiss|uphold)$/, "/operator/bookings/:id/blocking-complaint/:complaint/:action"],
  [/^\/operator\/bookings\/[^/]+\/(?:verified-access|blocking-complaint|guest-refund)$/, "/operator/bookings/:id/:action"],
  [/^\/operator\/bookings\/[^/]+$/, "/operator/bookings/:id"],
  [/^\/operator\/transfers\/[^/]+\/(?:receipt|confirm|reject|late-credit)$/, "/operator/transfers/:id/:action"],
  [/^\/operator\/transfers\/[^/]+$/, "/operator/transfers/:id"],
  [/^\/operator\/payouts\/[^/]+\/recovery$/, "/operator/payouts/:id/recovery"],
  [/^\/operator\/payouts\/[^/]+$/, "/operator/payouts/:id"],
  [/^\/operator\/calendar\/[^/]+\/blocks(?:\/[^/]+\/remove)?$/, "/operator/calendar/:id/blocks"],
  [/^\/api\/threads\/[^/]+$/, "/api/threads/:id"],
  [/^\/threads\/[^/]+$/, "/threads/:id"],
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPAQUE = /^[A-Za-z0-9_-]{30,}$/;

function redactSegment(segment: string): string {
  return UUID.test(segment) || OPAQUE.test(segment) ? ":id" : segment;
}

export function requestRouteTemplate(pathname: string): string {
  for (const [pattern, template] of ROUTE_TEMPLATES) {
    if (pattern.test(pathname)) return template;
  }
  const segments = pathname.split("/").filter((segment) => segment !== "");
  return `/${segments.map(redactSegment).join("/")}`;
}

export interface HttpRequestLog {
  readonly event: typeof HTTP_REQUEST_LOG_EVENT;
  /** A fresh server id per request; never a guest, session or operator id. */
  readonly request_id: string;
  readonly method: string;
  readonly route: string;
  readonly status: number;
  readonly duration_ms: number;
}

/** One JSON line per request. Fields are written by name, so no header, cookie, query or body value has a path into it. */
export function httpRequestLogLine(input: Omit<HttpRequestLog, "event">): string {
  return JSON.stringify({ event: HTTP_REQUEST_LOG_EVENT, ...input });
}

/** A rejection is logged by class only: a message can carry prompt, reply or identity text (ADR 0075). */
export function logUnhandledRejection(reason: unknown): void {
  try {
    const errorClass = reason instanceof Error ? reason.name : typeof reason;
    console.log(JSON.stringify({ event: UNHANDLED_REJECTION_LOG_EVENT, error_class: errorClass }));
  } catch {
    /* logging is observational */
  }
}

let unhandledRejectionRegistered = false;
function ensureUnhandledRejectionLogging(): void {
  if (unhandledRejectionRegistered) return;
  unhandledRejectionRegistered = true;
  try {
    if (typeof addEventListener === "function") {
      addEventListener("unhandledrejection", (event) => {
        logUnhandledRejection((event as unknown as { readonly reason?: unknown }).reason);
      });
    }
  } catch {
    /* the host has no event target; request logging still works */
  }
}

/**
 * The Worker is only a router (ADR 0004/0095). Static Assets serve the browser bundles and CSS before this runs
 * (09a/09b); every other request is forwarded to the tenant's one Durable Object, which owns all state.
 *
 * The tenant id is read straight from the binding rather than loading the full pilot configuration here: routing
 * must not depend on the Paystack or concierge secrets, and a missing tenant fails closed instead of choosing a
 * default.
 */
export default {
  fetch(request: WorkerRequest, env: CloudflareEnv) {
    ensureUnhandledRejectionLogging();
    const startedAtMs = Date.now();
    const requestId = crypto.randomUUID();
    const pathname = new URL(request.url).pathname;
    const route = requestRouteTemplate(pathname);
    const log = (status: number): void => {
      try {
        console.log(httpRequestLogLine({ request_id: requestId, method: request.method, route, status, duration_ms: Math.max(0, Date.now() - startedAtMs) }));
      } catch {
        /* logging is observational */
      }
    };
    // ADR 0101 / issue 24: private paths are refused even before tenant provisioning.
    if (isCommerceApiPath(pathname) || pathname === "/_internal" || pathname.startsWith("/_internal/")) {
      log(404);
      return Promise.resolve(new Response(JSON.stringify({ ok: false, code: "NOT_FOUND" }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      }) as unknown as WorkerResponse);
    }
    const tenantId = env.SHORTLET_TENANT_ID?.trim() ?? "";
    if (tenantId === "") {
      log(503);
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false, code: "NOT_PROVISIONED" }), {
          status: 503,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        }) as unknown as WorkerResponse,
      );
    }
    // ADR 0095/0101: each authority uses the same tenant name and best-effort placement hint.
    const namespace = isPlatformPath(pathname) ? env.PLATFORM : env.SHORTLET;
    return namespace.get(namespace.idFromName(tenantId), { locationHint: "afr" }).fetch(request).then(
      (response) => {
        log(response.status);
        return response;
      },
      (error: unknown) => {
        log(500);
        throw error;
      },
    );
  },
};
