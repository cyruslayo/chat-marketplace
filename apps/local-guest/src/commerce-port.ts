import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import type { SchemaMigration } from "../../../packages/platform-core/src/schema-migrations.js";
import type { RouteModule } from "./guest-shell.js";

/**
 * The neutral port between the guest server and the commerce domain (ADR 0099 decision 6, ADR 0104 decision 6). This file
 * imports nothing from domains/commerce. guest-server.ts takes a commerce module by injection; the default is none, so an
 * apartment host (the Shortlet Worker, the Node pilot hosts) never loads the commerce domain. A composition root that ships
 * commerce (the dev demo) injects the module from commerce-module-local.ts.
 */

/** The payment reference key pair (ADR 0075). Structurally the commerce domain's PaymentReferenceKeys. */
export interface PaymentReferenceKeys {
  readonly currentKeyId: string;
  readonly currentKey: string;
}

/** What the guest server hands the commerce module when commerce is on. */
export interface GuestCommerceDependencies {
  readonly database: SqlDatabase;
  readonly clock: () => Date;
  /** Omitted: the module reads the keys from its own environment source. */
  readonly paymentReferenceKeys?: PaymentReferenceKeys;
}

/** What the commerce module returns: the migrations the guest server applies, and the route module it mounts. */
export interface GuestCommerceParts {
  readonly migrations: readonly SchemaMigration[];
  readonly routeModule: RouteModule;
}

/** A commerce composition the guest server can inject. Only a composition root that ships commerce provides one. */
export interface GuestCommerceModule {
  compose(dependencies: GuestCommerceDependencies): GuestCommerceParts;
}
