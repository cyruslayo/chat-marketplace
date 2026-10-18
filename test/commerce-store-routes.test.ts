import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import type { HttpRequestLike, HttpResponseLike } from "../packages/platform-core/src/http-like.js";
import { createCommercePack } from "../domains/commerce/src/index.js";
import { createCommerceRouteModule } from "../apps/local-guest/src/commerce-route-module.js";
import { commerceDiscoveryPresentation } from "../apps/web-agent/src/commerce-presentation.js";
import { formatNgnKobo } from "../apps/web-agent/src/discovery-a2ui.js";

const clock = () => new Date("2026-10-18T10:00:00.000Z");

function fixture() {
  const database = new NodeSqliteDatabase(":memory:");
  const commerce = createCommercePack({ database, clock });
  commerce.directory.createMerchant({ id: "merchant", name: "Verified Merchant", status: "verified" });
  commerce.directory.createStore({ id: "store", merchantId: "merchant", slug: "daily-goods", name: "Daily Goods", status: "active" });
  commerce.catalogue.createProduct({ id: "product", name: "Oat Soap", category: "Bath", description: "Unscented daily soap" });
  commerce.catalogue.createOffer({ id: "offer", productId: "product", storeId: "store", priceKobo: 125050, stock: 7 });
  commerce.catalogue.createDeliveryZone({ id: "zone", storeId: "store", city: "Lagos", name: "Lagos Island", provider: "Merchant", feeKobo: 2500, isActive: true, sortOrder: 0 });
  const order = commerce.orders.createOrder({ storeId: "store", deliveryZoneId: "zone", customerName: "Consumer", customerPhone: "+234 801 234 5678", shippingAddress: { street: "Market Road" }, items: [{ offerId: "offer", quantity: 1 }], submittedTotalKobo: 127550, paymentReference: "test-payment-ref" });
  return { database, commerce, order };
}

async function request(module: ReturnType<typeof createCommerceRouteModule>, method: string, path: string, body = "") {
  let status = 0;
  let headers: Record<string, string | number> = {};
  let responseBody = "";
  const res: HttpResponseLike = {
    headersSent: false,
    writeHead(code, values = {}) { status = code; headers = values; return this; },
    setHeader() { return this; },
    end(value) { responseBody = String(value ?? ""); return this; },
    destroy() { return this; },
  };
  const req = Object.assign(new PassThrough(), {
    method,
    url: path,
    headers: { host: "localhost", "content-type": "application/x-www-form-urlencoded" },
  }) satisfies HttpRequestLike;
  const pending = module.tryHandle(req, res, new URL(path, "http://localhost"));
  req.end(body);
  const handled = await pending;
  return { handled, status, headers, body: responseBody };
}

test("AC1: Store page and chat show the same offer facts from one presentation helper", async () => {
  const { database, commerce } = fixture();
  try {
    const module = createCommerceRouteModule(commerce);
    const response = await request(module, "GET", "/s/daily-goods");
    assert.equal(response.handled, true);
    assert.equal(response.status, 200);
    // Assert visible content in the response, not merely the data-attribute contract.
    const offer = commerce.catalogue.offersForStore("store")[0]!;
    const chatPresentation = commerceDiscoveryPresentation([{ offerId: offer.offerId, productName: offer.productName, category: offer.category, description: offer.description, priceKobo: offer.priceKobo, stock: offer.stock }]).offers[0]!;
    assert.match(response.body, new RegExp(chatPresentation.productName));
    assert.match(response.body, new RegExp(chatPresentation.category));
    assert.match(response.body, new RegExp(chatPresentation.description));
    assert.ok(response.body.includes(formatNgnKobo(chatPresentation.priceKobo)));
    assert.match(response.body, new RegExp(`${chatPresentation.stock} available`));
    assert.match(response.body, /Verified store/);
    const offerPage = await request(module, "GET", "/s/daily-goods/offers/offer");
    assert.equal(offerPage.status, 200);
    assert.match(offerPage.body, /Oat Soap/);
    assert.match(offerPage.body, /Unscented daily soap/);
    assert.match(offerPage.body, /₦1,250\.50/);
    assert.match(offerPage.body, /Sold by Verified Merchant/);
  } finally {
    database.close();
  }
});

test("AC2: Order tracking requires both the public code and the matching phone", async () => {
  const { database, commerce, order } = fixture();
  try {
    const module = createCommerceRouteModule(commerce);
    const noPhone = await request(module, "POST", "/orders/track", new URLSearchParams({ publicCode: order.publicCode }).toString());
    const wrongPhone = await request(module, "POST", "/orders/track", new URLSearchParams({ publicCode: order.publicCode, phone: "08000000000" }).toString());
    const noCode = await request(module, "POST", "/orders/track", new URLSearchParams({ phone: "+234 801 234 5678" }).toString());
    const valid = await request(module, "POST", "/orders/track", new URLSearchParams({ publicCode: order.publicCode, phone: "+234 801 234 5678" }).toString());
    assert.match(noPhone.body, /could not find an order/i);
    assert.match(wrongPhone.body, /could not find an order/i);
    assert.match(noCode.body, /could not find an order/i);
    assert.doesNotMatch(wrongPhone.body, new RegExp(order.publicCode));
    assert.match(valid.body, new RegExp(order.publicCode));
    assert.match(valid.body, /Pending Verification/);
    assert.equal(valid.headers["Cache-Control"], "no-store");
  } finally {
    database.close();
  }
});

test("Commerce store routes return safe not-found pages for missing and malformed resources", async () => {
  const { database, commerce } = fixture();
  try {
    const module = createCommerceRouteModule(commerce);
    const missingStore = await request(module, "GET", "/s/not-a-store");
    const missingOffer = await request(module, "GET", "/s/daily-goods/offers/not-an-offer");
    const malformedOffer = await request(module, "GET", "/s/daily-goods/offers/%");
    assert.equal(missingStore.status, 404);
    assert.match(missingStore.body, /Store unavailable/);
    assert.equal(missingOffer.status, 404);
    assert.match(missingOffer.body, /Offer unavailable/);
    assert.equal(malformedOffer.status, 404);
    assert.match(malformedOffer.body, /Offer unavailable/);
  } finally {
    database.close();
  }
});
