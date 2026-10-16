import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import { openNodeSqliteDatabase } from "../../../packages/platform-core/src/node-sqlite-database.js";
import { createCommercePack, type MerchantBackOfficePrincipal } from "../../../domains/commerce/src/index.js";

/** Follows apps/local-owner: a composition root that opens one SQLite handle and exposes the commerce back office. */
export interface MerchantFixtureConfig {
  readonly databasePath: string;
  readonly merchantId: string;
  readonly merchantName: string;
  readonly storeId: string;
  readonly seedFixture?: boolean;
  readonly clock?: () => Date;
}

export const DEFAULT_MERCHANT_CONFIG: MerchantFixtureConfig = {
  databasePath: ".scratch/local-merchant/merchant_fixture.sqlite",
  merchantId: "merchant-lagos-001",
  merchantName: "Lagos Goods Ltd",
  storeId: "store-lagos-001",
  seedFixture: true,
};

const DEFAULT_CLOCK = (): Date => new Date("2026-10-16T00:00:00.000Z");

export class MerchantEnvironment {
  readonly config: MerchantFixtureConfig;
  readonly clock: () => Date;
  readonly pack: ReturnType<typeof createCommercePack>;
  readonly #database: SqlDatabase;
  #ownsDatabase = false;

  static openNode(config: Partial<MerchantFixtureConfig> = {}): MerchantEnvironment {
    const merged = { ...DEFAULT_MERCHANT_CONFIG, ...config };
    mkdirSync(dirname(merged.databasePath), { recursive: true });
    const database = openNodeSqliteDatabase(merged.databasePath);
    const environment = new MerchantEnvironment(merged, database);
    environment.#ownsDatabase = true;
    return environment;
  }

  constructor(config: Partial<MerchantFixtureConfig>, database: SqlDatabase) {
    this.config = { ...DEFAULT_MERCHANT_CONFIG, ...config };
    this.clock = this.config.clock ?? DEFAULT_CLOCK;
    this.#database = database;
    this.pack = createCommercePack({ database, clock: this.clock });
    if (this.config.seedFixture !== false) this.#seedFixture();
  }

  #seedFixture(): void {
    const { directory } = this.pack;
    if (directory.storeById(this.config.storeId)) return;
    directory.createMerchant({ id: this.config.merchantId, name: this.config.merchantName, status: "verified" });
    directory.createStore({ id: this.config.storeId, merchantId: this.config.merchantId, slug: this.config.storeId, name: this.config.merchantName, status: "active" });
  }

  merchantPrincipal(): MerchantBackOfficePrincipal {
    return { id: this.config.merchantId, role: "merchant" };
  }

  operatorPrincipal(operatorId = "platform-operator-001"): MerchantBackOfficePrincipal {
    return { id: operatorId, role: "operator" };
  }

  close(): void {
    if (this.#ownsDatabase) this.#database.close();
  }
}
