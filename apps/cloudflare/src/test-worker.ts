// The Workers Vitest runtime's entrypoint. It is the real Worker plus test-only namespaces.
import worker from "./worker.js";
import type { CloudflareEnv } from "./cloudflare-config.js";
import type { Request as WorkerRequest, Response as WorkerResponse } from "@cloudflare/workers-types";

interface DemoWorkerEnv extends CloudflareEnv {
  readonly DEMO_SHORTLET: CloudflareEnv["SHORTLET"];
  readonly DEMO_PLATFORM: CloudflareEnv["PLATFORM"];
}

export default {
  fetch(request: WorkerRequest, env: DemoWorkerEnv): Promise<WorkerResponse> {
    if (request.headers.get("x-shortlet-demo-test") === "enabled") {
      const tenantId = request.headers.get("x-shortlet-demo-tenant")?.trim() ?? "";
      if (tenantId === "") return Promise.resolve(new Response("Not found", { status: 404 }) as unknown as WorkerResponse);
      return worker.fetch(request, { ...env, SHORTLET_TENANT_ID: tenantId, SHORTLET: env.DEMO_SHORTLET, PLATFORM: env.DEMO_PLATFORM });
    }
    return worker.fetch(request, env);
  },
};
export * from "./worker.js";
export { TestHarnessDO } from "./test-harness-do.js";
export { ShortletPilot } from "./shortlet-pilot-do.js";
export { PlatformDO } from "./platform-do.js";
export { CommerceMarket } from "./commerce-market-do.js";

import type { DurableObjectNamespace, DurableObjectState } from "@cloudflare/workers-types";
import { ShortletPilot } from "./shortlet-pilot-do.js";
import { PlatformDO } from "./platform-do.js";
import { CommerceMarket } from "./commerce-market-do.js";

interface DemoTestBindings extends CloudflareEnv {
  readonly DEMO_SHORTLET: DurableObjectNamespace;
  readonly DEMO_PLATFORM: DurableObjectNamespace;
}

/** Test-only namespace with the owner's explicit staging demo configuration. */
export class DemoIsolatedShortletPilot extends ShortletPilot {
  constructor(ctx: DurableObjectState, env: DemoTestBindings) {
    const tenantId = ctx.id.name;
    if (!tenantId) throw new Error("Demo test Durable Object must use idFromName");
    super(ctx, {
      ...env,
      SHORTLET_TENANT_ID: tenantId,
      SHORTLET_DEMO: "enabled",
      SHORTLET: env.DEMO_SHORTLET,
      PLATFORM: env.DEMO_PLATFORM,
    });
  }
}

/** Test-only platform namespace paired with DemoIsolatedShortletPilot. */
export class DemoIsolatedPlatformDO extends PlatformDO {
  constructor(ctx: DurableObjectState, env: DemoTestBindings) {
    const tenantId = ctx.id.name;
    if (!tenantId) throw new Error("Demo test platform Durable Object must use idFromName");
    super(ctx, {
      ...env,
      SHORTLET_TENANT_ID: tenantId,
      SHORTLET: env.DEMO_SHORTLET,
      PLATFORM: env.DEMO_PLATFORM,
    });
  }
}

interface IsolatedTenantEnv extends CloudflareEnv {
  readonly ISOLATED_SHORTLET: DurableObjectNamespace;
  readonly ISOLATED_PLATFORM: DurableObjectNamespace;
  readonly ISOLATED_COMMERCE: DurableObjectNamespace;
}

/** Test-only namespaces whose IDs and configured tenant are the same per-test tenant key. */
export class IsolatedShortletPilot extends ShortletPilot {
  constructor(ctx: DurableObjectState, env: IsolatedTenantEnv) {
    const tenantId = ctx.id.name;
    if (!tenantId) throw new Error("Isolated test Durable Object must use idFromName");
    super(ctx, {
      ...env,
      SHORTLET_TENANT_ID: tenantId,
      SHORTLET: env.ISOLATED_SHORTLET,
      PLATFORM: env.ISOLATED_PLATFORM,
      COMMERCE: env.ISOLATED_COMMERCE,
    });
  }
}

export class IsolatedCommerceMarket extends CommerceMarket {
  constructor(ctx: DurableObjectState, env: IsolatedTenantEnv) {
    const tenantId = ctx.id.name;
    if (!tenantId) throw new Error("Isolated test Durable Object must use idFromName");
    // Test-only seam: a tenant named failing-* starts without its payment reference key, so its object is in the failed state.
    const failing = tenantId.startsWith("failing-");
    super(ctx, { ...env, SHORTLET_TENANT_ID: tenantId, ...(failing ? { COMMERCE_REFERENCE_HMAC_KEY: undefined } : {}) });
  }
}

export class IsolatedPlatformDO extends PlatformDO {
  constructor(ctx: DurableObjectState, env: IsolatedTenantEnv) {
    const tenantId = ctx.id.name;
    if (!tenantId) throw new Error("Isolated test Durable Object must use idFromName");
    // Test-only configured authority. Other test tenants retain their existing limits.
    const quotaLimits = tenantId.startsWith("quota-limits-")
      ? { CONCIERGE_DAILY_MODEL_CALL_CAP: "3", SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR: "2" }
      : {};
    super(ctx, {
      ...env,
      ...quotaLimits,
      SHORTLET_TENANT_ID: tenantId,
      SHORTLET: env.ISOLATED_SHORTLET,
      PLATFORM: env.ISOLATED_PLATFORM,
    });
  }
}
