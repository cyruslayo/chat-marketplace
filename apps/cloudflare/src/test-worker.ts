// The Workers Vitest runtime's entrypoint. It is the real Worker plus the test-only `TestHarnessDO` used by the
// harness and adapter specs, so `SELF.fetch` drives the actual Worker into the Durable Object (slice 10b AC4).
export { default } from "./worker.js";
export * from "./worker.js";
export { TestHarnessDO } from "./test-harness-do.js";
export { ShortletPilot } from "./shortlet-pilot-do.js";
export { PlatformDO } from "./platform-do.js";
export { CommerceMarket } from "./commerce-market-do.js";

import type { DurableObjectNamespace, DurableObjectState } from "@cloudflare/workers-types";
import type { CloudflareEnv } from "./cloudflare-config.js";
import { PlatformDO } from "./platform-do.js";
import { ShortletPilot } from "./shortlet-pilot-do.js";
import { CommerceMarket } from "./commerce-market-do.js";

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
    super(ctx, { ...env, SHORTLET_TENANT_ID: tenantId });
  }
}

export class IsolatedPlatformDO extends PlatformDO {
  constructor(ctx: DurableObjectState, env: IsolatedTenantEnv) {
    const tenantId = ctx.id.name;
    if (!tenantId) throw new Error("Isolated test Durable Object must use idFromName");
    super(ctx, {
      ...env,
      SHORTLET_TENANT_ID: tenantId,
      SHORTLET: env.ISOLATED_SHORTLET,
      PLATFORM: env.ISOLATED_PLATFORM,
    });
  }
}
