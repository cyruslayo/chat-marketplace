import { COMMERCE_TEST_REFERENCE_KEYS } from "./commerce-database.js";
import { NodeSqliteDatabase } from "../../packages/platform-core/src/node-sqlite-database.js";
import { createCommercePack } from "../../domains/commerce/src/index.js";
import { applySchemaMigrations } from "../../packages/platform-core/src/schema-migrations.js";
import type { OrderTrackingPolicy } from "../../domains/commerce/src/commerce-order.js";
import type { DeliveryCity } from "../../domains/commerce/src/delivery-zone.js";

export interface CommerceFixtureOptions {
  readonly clock: () => Date;
  readonly trackingPolicy?: OrderTrackingPolicy;
  readonly storeSlug?: string;
  readonly storeName?: string;
  readonly merchantName?: string;
  readonly productName?: string;
  readonly productCategory?: string;
  readonly productDescription?: string;
  readonly priceKobo?: number;
  readonly stock?: number;
  readonly feeKobo?: number;
  readonly zoneName?: string;
  readonly provider?: string;
  readonly city?: DeliveryCity;
  readonly customerPhone?: string;
  readonly submittedTotalKobo?: number;
  readonly paymentReference?: string;
}

/**
 * One migrated in-memory commerce database with a verified merchant, an active store, a product offer, a delivery zone and
 * one placed order. Shared by the domain and route tests so the tracking fixtures cannot drift apart (AGENTS anti-pattern 4).
 * Ids are fixed: merchant, store, product, offer and zone.
 */
export function createCommerceFixture(options: CommerceFixtureOptions) {
  const database = new NodeSqliteDatabase(":memory:");
  const commerce = createCommercePack({ database, clock: options.clock, paymentReferenceKeys: COMMERCE_TEST_REFERENCE_KEYS, ...(options.trackingPolicy === undefined ? {} : { trackingPolicy: options.trackingPolicy }) });
  applySchemaMigrations(database, commerce.migrations, options.clock().toISOString());
  const priceKobo = options.priceKobo ?? 10000;
  commerce.directory.createMerchant({ id: "merchant", name: options.merchantName ?? "Verified Merchant", status: "verified" });
  commerce.directory.createStore({ id: "store", merchantId: "merchant", slug: options.storeSlug ?? "store", name: options.storeName ?? "Store", status: "active" });
  commerce.catalogue.createProduct({ id: "product", name: options.productName ?? "Product", category: options.productCategory ?? "Category", description: options.productDescription ?? "" });
  commerce.catalogue.createOffer({ id: "offer", productId: "product", storeId: "store", priceKobo, stock: options.stock ?? 50 });
  commerce.catalogue.createDeliveryZone({ id: "zone", storeId: "store", city: options.city ?? "Lagos", name: options.zoneName ?? "Mainland", provider: options.provider ?? "Bolt", feeKobo: options.feeKobo ?? 0, isActive: true, sortOrder: 0 });
  const order = commerce.orders.createOrder({
    storeId: "store",
    deliveryZoneId: "zone",
    customerName: "Consumer",
    customerPhone: options.customerPhone ?? "+234 801 234 5678",
    shippingAddress: { street: "Market Road" },
    items: [{ offerId: "offer", quantity: 1 }],
    submittedTotalKobo: options.submittedTotalKobo ?? priceKobo + (options.feeKobo ?? 0),
    paymentReference: options.paymentReference ?? "payment-ref-1",
  });
  return { database, commerce, order };
}
