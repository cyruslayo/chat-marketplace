import { COMMERCE_TEST_REFERENCE_KEYS } from "../../../test/helpers/commerce-database.js";
import { paymentReferenceHash } from "../../../domains/commerce/src/payment-reference.js";
import { env, SELF, runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { createCommercePack, parseCreateOrderInput } from "../../../domains/commerce/src/index.js";
import { commerceMigrations } from "../../../test/helpers/commerce-database.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import { COMMERCE_EXPORT_TABLES, PLATFORM_EXPORT_TABLES, SHORTLET_EXPORT_TABLES, exportObjectKey, exportTable, lagosDate, type DailyExportDependencies } from "../src/do-export.js";
import { commerceCheckoutClient, commerceMigrationClient } from "../src/do-clients.js";
import type { CloudflareEnv } from "../src/cloudflare-config.js";
import { accessToken, isolatedWorkerFetch, opsHeaders } from "./ops-test-helpers.js";
import { checkoutPayload, seedCommerceFixture, type CommerceFixtureIds } from "./commerce-test-helpers.js";

const tenant = `commerce-${crypto.randomUUID()}`;
const isolatedCommerce = (name: string) => env.ISOLATED_COMMERCE.get(env.ISOLATED_COMMERCE.idFromName(name));
const tableNames = (db: DurableObjectSqlDatabase): string[] => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all().map(row => String(row.name));
const orderCount = (db: DurableObjectSqlDatabase): number => Number(db.prepare("SELECT COUNT(*) AS total FROM merchant_orders").get()?.total ?? 0);
const offerStock = (db: DurableObjectSqlDatabase, offerId: string): number => Number(db.prepare("SELECT stock FROM merchant_offers WHERE id = $id").get({ $id: offerId })?.stock);

const CHECKOUT_IDS: CommerceFixtureIds = { merchantId: "checkout-merchant", storeId: "checkout-store", productId: "checkout-product", offerId: "checkout-offer", zoneId: "checkout-zone" };
/** A fresh commerce DO whose tenant name is its own key, seeded with the checkout fixture (stock 1, total 1000). */
async function seededCheckoutCommerce(label: string): Promise<{ stub: ReturnType<typeof isolatedCommerce>; tenantId: string }> {
  const tenantId = `${label}-${crypto.randomUUID()}`;
  const stub = isolatedCommerce(tenantId);
  await runInDurableObject(stub, (_instance, ctx) => seedCommerceFixture(new DurableObjectSqlDatabase(ctx.storage), { ...CHECKOUT_IDS, priceKobo: 1000, stock: 1, deliveryFeeKobo: 0 }));
  return { stub, tenantId };
}
/** The internal checkout route: the typed client's wire shape, with the tenant key the DO checks (ADR 0101). */
const internalCheckout = (stub: ReturnType<typeof isolatedCommerce>, tenantId: string, body: Record<string, unknown>) =>
  stub.fetch("https://do.internal/_internal/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId, ...body }) });

test("24 AC1: commerce data lives only in the commerce DO after order traffic, disjoint from platform and shortlet", async () => {
  const commerce = isolatedCommerce(tenant);
  const shortlet = env.ISOLATED_SHORTLET.get(env.ISOLATED_SHORTLET.idFromName(tenant));
  const platform = env.ISOLATED_PLATFORM.get(env.ISOLATED_PLATFORM.idFromName(tenant));
  const ids: CommerceFixtureIds = { merchantId: "merchant", storeId: "store", productId: "product", offerId: "offer", zoneId: "zone" };
  const clock = () => new Date("2026-10-18T00:00:00Z");
  // Order creation is a domain write; the public and internal routes never create orders while payment is unavailable.
  await runInDurableObject(commerce, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    seedCommerceFixture(database, { ...ids, priceKobo: 800, stock: 3, deliveryFeeKobo: 100, clock });
    createCommercePack({ paymentReferenceKeys: COMMERCE_TEST_REFERENCE_KEYS, database, clock }).orders.createOrder(parseCreateOrderInput(checkoutPayload(ids)));
  });
  const [commerceTables, shortletTables, platformTables] = await Promise.all([
    runInDurableObject(commerce, (_instance, ctx) => tableNames(new DurableObjectSqlDatabase(ctx.storage))),
    runInDurableObject(shortlet, (_instance, ctx) => tableNames(new DurableObjectSqlDatabase(ctx.storage))),
    runInDurableObject(platform, (_instance, ctx) => tableNames(new DurableObjectSqlDatabase(ctx.storage))),
  ]);
  expect(commerceTables).toContain("merchant_orders");
  expect(commerceTables).toContain("products");
  expect(shortletTables.some(table => COMMERCE_EXPORT_TABLES.includes(table as typeof COMMERCE_EXPORT_TABLES[number]))).toBe(false);
  expect(platformTables.some(table => COMMERCE_EXPORT_TABLES.includes(table as typeof COMMERCE_EXPORT_TABLES[number]))).toBe(false);
  expect(commerceTables.some(table => SHORTLET_EXPORT_TABLES.includes(table as typeof SHORTLET_EXPORT_TABLES[number]))).toBe(false);
  expect(commerceTables.some(table => PLATFORM_EXPORT_TABLES.includes(table as typeof PLATFORM_EXPORT_TABLES[number]))).toBe(false);
});

test("24 AC1 / decision 7: commerce export carries only the payment reference hash, never the raw reference", async () => {
  const tenantId = `commerce-export-${crypto.randomUUID()}`;
  const stub = isolatedCommerce(tenantId);
  const clock = () => new Date("2026-10-18T00:00:00Z");
  await runInDurableObject(stub, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    seedCommerceFixture(database, { ...CHECKOUT_IDS, priceKobo: 1000, stock: 1, deliveryFeeKobo: 0, clock });
    createCommercePack({ paymentReferenceKeys: COMMERCE_TEST_REFERENCE_KEYS, database, clock }).orders.createOrder(parseCreateOrderInput(checkoutPayload(CHECKOUT_IDS, { submittedTotalKobo: 1000, paymentReference: "export-secret-ref" })));
  });
  const date = "2040-02-02";
  await runInDurableObject(stub, async (_instance, ctx) => {
    const dependencies: DailyExportDependencies = {
      database: new DurableObjectSqlDatabase(ctx.storage), receipts: env.RECEIPTS, exports: env.EXPORTS, clock,
      retentionDays: 400, orphanGraceHours: 24, tableOwner: "commerce",
    };
    await exportTable(dependencies, date, "merchant_orders");
  });
  const text = await (await env.EXPORTS.get(exportObjectKey(date, "merchant_orders")))!.text();
  try {
    const rows = text.split("\n").filter(line => line !== "");
    expect(rows).toHaveLength(1);
    expect(text).not.toContain("export-secret-ref");
    const row = JSON.parse(rows[0]!) as Record<string, unknown>;
    expect(row).toHaveProperty("public_code");
    expect(row).not.toHaveProperty("payment_reference");
    expect(row.payment_reference_hash).toBe(paymentReferenceHash(COMMERCE_TEST_REFERENCE_KEYS, "export-secret-ref"));
  } finally {
    await env.EXPORTS.delete(exportObjectKey(date, "merchant_orders"));
  }
});

test("24 AC1: commerce DO refuses internal ops for a missing or foreign tenant (fail closed)", async () => {
  const tenantName = `commerce-scope-${crypto.randomUUID()}`;
  const commerce = isolatedCommerce(tenantName);
  const post = (body: unknown) => commerce.fetch("https://do.internal/_internal/ops/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  for (const body of [{}, { tenantId: "" }, { tenantId: "tenant-foreign" }, { tenantId: null }]) {
    const response = await post(body);
    expect(response.status, JSON.stringify(body)).toBe(403);
    expect(await response.json()).toEqual({ ok: false, code: "INVALID_SCOPE" });
  }
  const matched = await post({ tenantId: tenantName });
  expect(matched.status).toBe(200);
});

test("24 AC1: commerce migration client refuses a foreign tenant on the call, fail closed (review 6: lazy)", async () => {
  const commerceEnv = env as unknown as CloudflareEnv;
  await expect(commerceMigrationClient(commerceEnv, "tenant-foreign").request("status")).rejects.toThrow("Tenant does not match the configured commerce tenant");
  await expect(commerceMigrationClient(commerceEnv, "   ").request("status")).rejects.toThrow("Tenant does not match the configured commerce tenant");
});

test("24 AC1: commerce migration client builds for the configured tenant without a call (review 6: lazy)", () => {
  expect(() => commerceMigrationClient(env as unknown as CloudflareEnv, "tenant-synthetic")).not.toThrow();
});

test("24 AC2: internal checkout client throws on a tenant mismatch and accepts only the configured tenant (fail closed)", () => {
  const commerceEnv = env as unknown as CloudflareEnv;
  expect(() => commerceCheckoutClient(commerceEnv, "tenant-foreign")).toThrow("Tenant does not match the configured commerce tenant");
  expect(() => commerceCheckoutClient(commerceEnv, "")).toThrow("Tenant does not match the configured commerce tenant");
  expect(() => commerceCheckoutClient(commerceEnv, "tenant-synthetic")).not.toThrow();
});

test("24 AC2: internal checkout client overwrites any caller-supplied tenantId with the configured tenant", async () => {
  const ids: CommerceFixtureIds = { merchantId: `override-merchant-${crypto.randomUUID()}`, storeId: `override-store-${crypto.randomUUID()}`, productId: `override-product-${crypto.randomUUID()}`, offerId: `override-offer-${crypto.randomUUID()}`, zoneId: `override-zone-${crypto.randomUUID()}` };
  const commerce = env.COMMERCE.get(env.COMMERCE.idFromName("tenant-synthetic"));
  await runInDurableObject(commerce, (_instance, ctx) => seedCommerceFixture(new DurableObjectSqlDatabase(ctx.storage), { ...ids, priceKobo: 1000, stock: 1, deliveryFeeKobo: 0 }));
  const client = commerceCheckoutClient(env as unknown as CloudflareEnv, "tenant-synthetic");
  // The client sets the configured tenant after the caller's fields, so the DO sees the configured tenant and accepts the call.
  const result = await client.checkout({ ...checkoutPayload(ids, { submittedTotalKobo: 1000, paymentReference: "override-ref" }), tenantId: "tenant-foreign" });
  expect(result).toEqual({ status: 409, body: { ok: false, code: "payment_unavailable" } });
});

test("24 AC1: commerce DO internal ops refuse a request that carries an unexpected key", async () => {
  const tenantName = `commerce-keys-${crypto.randomUUID()}`;
  const commerce = isolatedCommerce(tenantName);
  const response = await commerce.fetch("https://do.internal/_internal/ops/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: tenantName, table: "merchants", rows: [], extra: true }) });
  expect(response.status).toBe(404);
  const rows = await runInDurableObject(commerce, (_instance, ctx) => Number(new DurableObjectSqlDatabase(ctx.storage).prepare("SELECT COUNT(*) AS total FROM merchants").get()?.total ?? 0));
  expect(rows).toBe(0);
});

test("24 AC2: a public POST to /api/commerce/orders is refused with 404 and never reaches CommerceMarket", async () => {
  const { stub, tenantId } = await seededCheckoutCommerce("public-route");
  const routed = await SELF.fetch("https://pilot.example.test/api/commerce/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(checkoutPayload(CHECKOUT_IDS, { submittedTotalKobo: 1000, paymentReference: "public-route-ref" })) });
  expect(routed.status).toBe(404);
  expect(await routed.json()).toEqual({ ok: false, code: "NOT_FOUND" });
  const direct = await stub.fetch("https://do.internal/api/commerce/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId, ...checkoutPayload(CHECKOUT_IDS) }) });
  expect(direct.status).toBe(404);
  const orders = await runInDurableObject(stub, (_instance, ctx) => orderCount(new DurableObjectSqlDatabase(ctx.storage)));
  expect(orders).toBe(0);
});

test("24 AC2: internal checkout with a server-matching total returns 409 payment_unavailable and writes no order and reserves no stock", async () => {
  const { stub, tenantId } = await seededCheckoutCommerce("unavailable");
  const response = await internalCheckout(stub, tenantId, checkoutPayload(CHECKOUT_IDS, { submittedTotalKobo: 1000, paymentReference: "checkout-secret-ref" }));
  expect(response.status).toBe(409);
  const body = await response.text();
  expect(JSON.parse(body)).toEqual({ ok: false, code: "payment_unavailable" });
  expect(body).not.toContain("checkout-secret-ref");
  const state = await runInDurableObject(stub, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    return { orders: orderCount(database), stock: offerStock(database, CHECKOUT_IDS.offerId) };
  });
  expect(state).toEqual({ orders: 0, stock: 1 });
});

test("24 AC2: internal checkout with a submitted total that does not match the server is refused with ORDER_REJECTED", async () => {
  const { stub, tenantId } = await seededCheckoutCommerce("mismatch");
  const rejected = await internalCheckout(stub, tenantId, checkoutPayload(CHECKOUT_IDS, { submittedTotalKobo: 1, paymentReference: "worker-test-invalid-ref" }));
  expect(rejected.status).toBe(400);
  expect(await rejected.json()).toMatchObject({ ok: false, code: "ORDER_REJECTED" });
  expect(await runInDurableObject(stub, (_instance, ctx) => offerStock(new DurableObjectSqlDatabase(ctx.storage), CHECKOUT_IDS.offerId))).toBe(1);
});

test("issue 24 decision 11: internal checkout for a store whose merchant is not verified is refused with ORDER_REJECTED and reserves nothing", async () => {
  const { stub, tenantId } = await seededCheckoutCommerce("unverified");
  await runInDurableObject(stub, (_instance, ctx) => {
    createCommercePack({ paymentReferenceKeys: COMMERCE_TEST_REFERENCE_KEYS, database: new DurableObjectSqlDatabase(ctx.storage), clock: () => new Date() }).directory.updateMerchantStatus(CHECKOUT_IDS.merchantId, "suspended");
  });
  const refused = await internalCheckout(stub, tenantId, checkoutPayload(CHECKOUT_IDS, { submittedTotalKobo: 1000, paymentReference: "unverified-ref" }));
  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({ ok: false, code: "ORDER_REJECTED" });
  expect(await runInDurableObject(stub, (_instance, ctx) => offerStock(new DurableObjectSqlDatabase(ctx.storage), CHECKOUT_IDS.offerId))).toBe(1);
});

test("24 AC2 refusal: internal checkout for an unavailable store, zone or offer, or insufficient stock is refused with ORDER_REJECTED and reserves nothing", async () => {
  const { stub, tenantId } = await seededCheckoutCommerce("domain-rules");
  const refusals: Array<[string, Record<string, unknown>]> = [
    ["the store does not exist", { storeId: "missing-store" }],
    ["the delivery zone does not exist", { deliveryZoneId: "missing-zone" }],
    ["the offer is not in this store", { items: [{ offerId: "missing-offer", quantity: 1 }] }],
    ["the requested quantity exceeds stock", { items: [{ offerId: CHECKOUT_IDS.offerId, quantity: 2 }], submittedTotalKobo: 2000 }],
  ];
  for (const [label, overrides] of refusals) {
    const response = await internalCheckout(stub, tenantId, checkoutPayload(CHECKOUT_IDS, { submittedTotalKobo: 1000, ...overrides }));
    expect(response.status, label).toBe(400);
    expect(await response.json(), label).toMatchObject({ ok: false, code: "ORDER_REJECTED" });
  }
  const state = await runInDurableObject(stub, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    return { orders: orderCount(database), stock: offerStock(database, CHECKOUT_IDS.offerId) };
  });
  expect(state).toEqual({ orders: 0, stock: 1 });
});

test("24 AC2 refusal: checkout with malformed items, offerId, paymentReference or other fields is refused with BAD_REQUEST and creates no order", async () => {
  const { stub, tenantId } = await seededCheckoutCommerce("malformed");
  const malformed: Array<[string, Record<string, unknown>]> = [
    ["items is not an array", { items: "checkout-offer" }],
    ["items is empty", { items: [] }],
    ["an item is not an object", { items: ["checkout-offer"] }],
    ["item offerId is not a string", { items: [{ offerId: 7, quantity: 1 }] }],
    ["item offerId is blank", { items: [{ offerId: "   ", quantity: 1 }] }],
    ["item quantity is zero", { items: [{ offerId: "checkout-offer", quantity: 0 }] }],
    ["item quantity is fractional", { items: [{ offerId: "checkout-offer", quantity: 1.5 }] }],
    ["item variantId is not a string", { items: [{ offerId: "checkout-offer", variantId: 3, quantity: 1 }] }],
    ["offerId is missing from the item", { items: [{ quantity: 1 }] }],
    ["paymentReference is not a string", { paymentReference: 12345 }],
    ["paymentReference is blank", { paymentReference: "" }],
    ["submittedTotalKobo is not an integer", { submittedTotalKobo: "1000" }],
    ["storeId is missing", { storeId: undefined }],
    ["customerName is not a string", { customerName: 42 }],
    ["shippingAddress is empty", { shippingAddress: {} }],
  ];
  for (const [label, overrides] of malformed) {
    const response = await internalCheckout(stub, tenantId, checkoutPayload(CHECKOUT_IDS, overrides));
    expect(response.status, label).toBe(400);
    expect(await response.json(), label).toEqual({ ok: false, code: "BAD_REQUEST" });
  }
  const state = await runInDurableObject(stub, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    return { orders: orderCount(database), stock: offerStock(database, CHECKOUT_IDS.offerId) };
  });
  expect(state).toEqual({ orders: 0, stock: 1 });
});


/** Shortlet ops calls for one tenant; each test names the single criterion it checks (issue 24 review 9). */
async function commerceOps(tenantId: string) {
  const headers = opsHeaders(await accessToken());
  return (method: string, path: string, body?: unknown) => isolatedWorkerFetch(tenantId, new Request(`https://pilot.example.test${path}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}
const MERCHANT_ROW = { id: "commerce-ops-merchant", name: "Merchant", status: "verified", created_at: "2026-10-18", updated_at: "2026-10-18" };

test("24 AC1: the Shortlet status route reports the commerce expected schema version derived from the migration list", async () => {
  const tenantId = `commerce-status-${crypto.randomUUID()}`;
  const ops = await commerceOps(tenantId);
  const status = await ops("GET", "/_ops/status");
  expect(status.status).toBe(200);
  const expected = await runInDurableObject(env.ISOLATED_COMMERCE.get(env.ISOLATED_COMMERCE.idFromName(`expected-${tenantId}`)), (_instance, ctx) => commerceMigrations(new DurableObjectSqlDatabase(ctx.storage)).length + 1);
  expect((await status.json() as { commerce: { expectedSchemaVersion: number } }).commerce.expectedSchemaVersion).toBe(expected);
});

test("24 AC1: a Shortlet ops import of a commerce table is accepted by the commerce object", async () => {
  const ops = await commerceOps(`commerce-import-${crypto.randomUUID()}`);
  const imported = await ops("POST", "/_ops/import", { table: "merchants", rows: [MERCHANT_ROW] });
  expect(imported.status).toBe(200);
});

test("24 AC1: a Shortlet ops export of a commerce table returns the rows the commerce object holds", async () => {
  const ops = await commerceOps(`commerce-export-ops-${crypto.randomUUID()}`);
  expect((await ops("POST", "/_ops/import", { table: "merchants", rows: [MERCHANT_ROW] })).status).toBe(200);
  const exported = await ops("GET", "/_ops/export?table=merchants");
  expect(exported.status).toBe(200);
  expect((await exported.json() as { rowCount: number }).rowCount).toBe(1);
});

test("24 AC1: the Shortlet verify route lists merchant_orders among the commerce tables", async () => {
  const ops = await commerceOps(`commerce-verify-${crypto.randomUUID()}`);
  const verify = await ops("GET", "/_ops/import/verify");
  expect((await verify.json() as { commerce: { tables: Record<string, unknown> } }).commerce.tables).toHaveProperty("merchant_orders");
});

test("24 AC1: the Shortlet cutover records the commerce cutover, and a commerce import is refused afterwards", async () => {
  const ops = await commerceOps(`commerce-cutover-${crypto.randomUUID()}`);
  expect((await ops("POST", "/_ops/cutover/complete", {})).status).toBe(200);
  const refused = await ops("POST", "/_ops/import", { table: "merchants", rows: [{ ...MERCHANT_ROW, id: "after-cutover" }] });
  expect(refused.status).toBe(400);
});

test("issue 24 review 10: a commerce import of a merchant_orders row with a raw payment reference is refused and writes nothing", async () => {
  const tenantName = `commerce-hash-import-${crypto.randomUUID()}`;
  const commerce = env.ISOLATED_COMMERCE.get(env.ISOLATED_COMMERCE.idFromName(tenantName));
  const response = await commerce.fetch("https://do.internal/_internal/ops/import", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tenantName, table: "merchant_orders", rows: [{ id: "raw-order", payment_reference_hash: "raw-payment-reference" }] }),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ ok: false, code: "INVALID_PAYMENT_REFERENCE_HASH" });
  const rows = await runInDurableObject(commerce, (_instance, ctx) => Number(new DurableObjectSqlDatabase(ctx.storage).prepare("SELECT COUNT(*) AS total FROM merchant_orders").get()?.total ?? 0));
  expect(rows).toBe(0);
});

test("24 AC1: commerce ops are not exposed on the Shortlet Worker's internal path", async () => {
  expect((await SELF.fetch("https://pilot.example.test/_internal/ops/status", { method: "POST", body: "{}" })).status).toBe(404);
});

test("24 AC1: CommerceMarket daily alarm exports its own commerce tables and reschedules", async () => {
  const stub = isolatedCommerce(tenant);
  const date = lagosDate(new Date());
  const alarm = await runInDurableObject(stub, async (instance, ctx) => {
    await instance.alarm();
    return await ctx.storage.getAlarm();
  });
  expect(alarm).toBeGreaterThan(Date.now());
  for (const table of COMMERCE_EXPORT_TABLES) {
    expect(await env.EXPORTS.get(`${date}/${table}.jsonl`), `${table} commerce export`).not.toBeNull();
    await env.EXPORTS.delete(`${date}/${table}.jsonl`);
  }
});

test("24 AC3: Shortlet Worker paths retain their routing and unprovisioned response", async () => {
  const shortletResponse = await SELF.fetch("https://pilot.example.test/healthz");
  expect(shortletResponse.status).toBe(503);
  expect(await shortletResponse.json()).toEqual({ ok: false, code: "NOT_PROVISIONED" });
});
