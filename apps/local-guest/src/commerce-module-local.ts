import { createCommercePack } from "../../../domains/commerce/src/index.js";
import type { GuestCommerceModule } from "./commerce-port.js";
import { commerceReferenceKeysFromProcessEnv } from "./commerce-reference-keys-local.js";
import { createCommerceRouteModule } from "./commerce-route-module.js";

/**
 * The commerce composition the local dev demo injects (ADR 0104 decision 4). Only a composition root that ships commerce
 * imports this file. The switch (COMMERCE_ENABLED, ADR 0104 decision 5) still decides whether guest-server calls it.
 */
export const LOCAL_COMMERCE_MODULE: GuestCommerceModule = {
  compose({ database, clock, paymentReferenceKeys }) {
    const pack = createCommercePack({
      database,
      clock,
      paymentReferenceKeys: paymentReferenceKeys ?? commerceReferenceKeysFromProcessEnv(process.env, process.env.NODE_ENV),
    });
    return { migrations: pack.migrations, routeModule: createCommerceRouteModule(pack) };
  },
};
