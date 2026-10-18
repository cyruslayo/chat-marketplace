import { COMMERCE_TEST_REFERENCE_KEYS } from "../../../test/helpers/commerce-database.js";
import { createCommercePack } from "../../../domains/commerce/src/index.js";
import type { DurableObjectSqlDatabase } from "../src/do-sql-database.js";

/** Shared commerce fixtures for the commerce workers specs (AGENTS.md: no duplicated test fixtures). */
export interface CommerceFixtureIds {
  readonly merchantId: string;
  readonly storeId: string;
  readonly productId: string;
  readonly offerId: string;
  readonly zoneId: string;
}

export interface CommerceFixtureOptions extends CommerceFixtureIds {
  readonly priceKobo: number;
  readonly stock: number;
  readonly deliveryFeeKobo: number;
  readonly clock?: () => Date;
}

/**
 * Seeds one verified merchant, its active store, one product with one offer and one active delivery zone through the
 * commerce pack, inside the Durable Object that owns the commerce SQL (pass `new DurableObjectSqlDatabase(ctx.storage)`).
 */
export function seedCommerceFixture(database: DurableObjectSqlDatabase, options: CommerceFixtureOptions): void {
  const pack = createCommercePack({ paymentReferenceKeys: COMMERCE_TEST_REFERENCE_KEYS, database, clock: options.clock ?? (() => new Date()) });
  pack.directory.createMerchant({ id: options.merchantId, name: "Merchant", status: "verified" });
  pack.directory.createStore({ id: options.storeId, merchantId: options.merchantId, slug: options.storeId, name: "Store", status: "active" });
  pack.catalogue.createProduct({ id: options.productId, name: "Product", category: "Goods" });
  pack.catalogue.createOffer({ id: options.offerId, productId: options.productId, storeId: options.storeId, priceKobo: options.priceKobo, stock: options.stock });
  pack.catalogue.createDeliveryZone({ id: options.zoneId, storeId: options.storeId, city: "Lagos", name: "Zone", provider: "Courier", feeKobo: options.deliveryFeeKobo, isActive: true, sortOrder: 0 });
}

/** A valid checkout body for the seeded fixture; callers override only the field a case is about. */
export function checkoutPayload(ids: CommerceFixtureIds, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    storeId: ids.storeId,
    deliveryZoneId: ids.zoneId,
    customerName: "Ada",
    customerPhone: "08031234567",
    shippingAddress: { address: "Test" },
    items: [{ offerId: ids.offerId, quantity: 1 }],
    submittedTotalKobo: 900,
    paymentReference: "synthetic-order-ref",
    ...overrides,
  };
}
