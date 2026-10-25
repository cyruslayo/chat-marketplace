import { env, runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { COMMERCE_TEST_REFERENCE_KEYS } from "../../../test/helpers/commerce-database.js";
import { createCommercePack } from "../../../domains/commerce/src/index.js";
import { applySchemaMigrations } from "../../../packages/platform-core/src/schema-migrations.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import { commerceMigrationsWithCutover } from "../src/commerce-migrations.js";
import { seedCommerceFixture, type CommerceFixtureIds } from "./commerce-test-helpers.js";

/**
 * ADR 0104 decision 5 and the ADR 0100/0101 amendments (25 Oct 2026): commerce is off unless COMMERCE_ENABLED is exactly "true".
 * Tenants named `commerce-off-*` start with the switch unset and no key pair (test seam in src/test-worker.ts); `commerce-invalid-*`
 * start with an invalid value; `failing-*` is the existing ON-with-missing-key seam.
 */
const stubFor = (tenantId: string) => env.ISOLATED_COMMERCE.get(env.ISOLATED_COMMERCE.idFromName(tenantId));
const off = (label: string) => `commerce-off-${label}-${crypto.randomUUID()}`;
const post = (tenantId: string, path: string, body: Record<string, unknown>) =>
  stubFor(tenantId).fetch(`https://do.internal${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId, ...body }) });
const IDS: CommerceFixtureIds = { merchantId: "switch-merchant", storeId: "switch-store", productId: "switch-product", offerId: "switch-offer", zoneId: "switch-zone" };

test("ADR 0104 decision 5: with COMMERCE_ENABLED unset and no key pair the commerce object constructs and checkout fails closed with COMMERCE_DISABLED", async () => {
  const tenantId = off("checkout");
  const response = await post(tenantId, "/_internal/checkout", { storeId: IDS.storeId });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, code: "COMMERCE_DISABLED" });
});

test("ADR 0104 decision 5: with commerce off the rows operation counts zero commerce rows on an object with no commerce tables", async () => {
  const response = await post(off("rows"), "/_internal/ops/rows", {});
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, rowCount: 0 });
});

test("ADR 0104 decision 5: with commerce off an empty import batch succeeds and writes nothing", async () => {
  const tenantId = off("empty-import");
  const response = await post(tenantId, "/_internal/ops/import", { table: "products", rows: [] });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true });
  expect(await (await post(tenantId, "/_internal/ops/rows", {})).json()).toEqual({ ok: true, rowCount: 0 });
});

test("ADR 0104 decision 5: with commerce off a non-empty import is refused with COMMERCE_DISABLED and nothing is written", async () => {
  const tenantId = off("import");
  const response = await post(tenantId, "/_internal/ops/import", { table: "products", rows: [{ id: "synthetic-product" }] });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, code: "COMMERCE_DISABLED" });
  expect(await (await post(tenantId, "/_internal/ops/rows", {})).json()).toEqual({ ok: true, rowCount: 0 });
});

test("ADR 0096 amendment (25 Oct 2026): with commerce off, export still returns commerce rows when rows exist", async () => {
  const tenantId = off("export");
  await runInDurableObject(stubFor(tenantId), (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    const clock = () => new Date("2026-10-25T00:00:00Z");
    applySchemaMigrations(database, commerceMigrationsWithCutover(createCommercePack({ paymentReferenceKeys: COMMERCE_TEST_REFERENCE_KEYS, database, clock }).migrations), clock().toISOString());
    seedCommerceFixture(database, { ...IDS, priceKobo: 800, stock: 3, deliveryFeeKobo: 0, clock });
  });
  const rows = await (await post(tenantId, "/_internal/ops/rows", {})).json() as { rowCount: number };
  expect(rows.rowCount).toBeGreaterThan(0);
  const exported = await post(tenantId, "/_internal/ops/export", { table: "products" });
  expect(exported.status).toBe(200);
  expect(await exported.json()).toMatchObject({ ok: true, table: "products", rowCount: 1 });
});

test("ADR 0104 decision 5: an invalid COMMERCE_ENABLED value stops the object with COMMERCE_ENABLED_INVALID and never echoes the value", async () => {
  const tenantId = `commerce-invalid-${crypto.randomUUID()}`;
  const response = await post(tenantId, "/_internal/checkout", { storeId: IDS.storeId });
  const text = await response.text();
  expect(response.status).toBe(503);
  expect(JSON.parse(text)).toEqual({ ok: false, code: "COMMERCE_ENABLED_INVALID" });
  expect(text).not.toContain("maybe-value");
});

test("ADR 0075 / issue 24: with commerce on and a missing key pair the existing fixed key code still refuses every request", async () => {
  const tenantId = `failing-${crypto.randomUUID()}`;
  const response = await post(tenantId, "/_internal/checkout", { storeId: IDS.storeId });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, code: "COMMERCE_REFERENCE_KEY_INVALID" });
});
