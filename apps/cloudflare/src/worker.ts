import type { Request as WorkerRequest, Response as WorkerResponse } from "@cloudflare/workers-types";
import type { CloudflareEnv } from "./cloudflare-config.js";

export { ShortletPilot } from "./shortlet-pilot-do.js";

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
    // ADR 0004/0095: one Durable Object per tenant, placed nearest the launch region.
    return env.SHORTLET.get(env.SHORTLET.idFromName(tenantId), { locationHint: "afr" }).fetch(request);
  },
};
