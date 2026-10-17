import type { Request as WorkerRequest, Response as WorkerResponse } from "@cloudflare/workers-types";
import type { CloudflareEnv } from "./cloudflare-config.js";

export { ShortletPilot } from "./shortlet-pilot-do.js";
export { PlatformDO } from "./platform-do.js";

/** Account/session and thread ownership routes terminate at the platform authority (ADR 0101). */
export function isPlatformPath(pathname: string): boolean {
  return pathname === "/account" || pathname.startsWith("/account/") ||
    pathname === "/api/threads" || pathname.startsWith("/api/threads/") ||
    pathname === "/threads" || pathname.startsWith("/threads/");
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
    const tenantId = env.SHORTLET_TENANT_ID?.trim() ?? "";
    if (tenantId === "") {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false, code: "NOT_PROVISIONED" }), {
          status: 503,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        }) as unknown as WorkerResponse,
      );
    }
    const pathname = new URL(request.url).pathname;
    if (pathname === "/_internal" || pathname.startsWith("/_internal/")) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, code: "NOT_FOUND" }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      }) as unknown as WorkerResponse);
    }
    // ADR 0095/0101: each authority uses the same tenant name and best-effort placement hint.
    const namespace = isPlatformPath(pathname) ? env.PLATFORM : env.SHORTLET;
    return namespace.get(namespace.idFromName(tenantId), { locationHint: "afr" }).fetch(request);
  },
};
