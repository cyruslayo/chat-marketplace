import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import type { HttpRequestLike, HttpResponseLike } from "../packages/platform-core/src/http-like.js";
import { createCommerceFixture } from "./helpers/commerce-fixture.js";
import { createCommerceRouteModule } from "../apps/local-guest/src/commerce-route-module.js";
import { commerceDiscoveryPresentation, commerceDiscoverySurface } from "../apps/web-agent/src/commerce-presentation.js";
import { assertSurfaceReferencesResolve } from "./helpers/a2ui-surface-integrity.js";
import { formatNgnKobo } from "../apps/web-agent/src/discovery-a2ui.js";
import { formatWatDateTime } from "../apps/web/src/ui-kit.js";

const clock = () => new Date("2026-10-18T10:00:00.000Z");

function fixture() {
  return createCommerceFixture({
    clock,
    storeSlug: "daily-goods",
    storeName: "Daily Goods",
    merchantName: "Verified Merchant",
    productName: "Oat Soap",
    productCategory: "Bath",
    productDescription: "Unscented daily soap",
    priceKobo: 125050,
    stock: 7,
    feeKobo: 2500,
    zoneName: "Lagos Island",
    provider: "Merchant",
    customerPhone: "+234 801 234 5678",
    submittedTotalKobo: 127550,
    paymentReference: "test-payment-ref",
  });
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
    const chatPresentation = commerceDiscoveryPresentation([{ offerId: offer.offerId, productName: offer.productName, category: offer.category, description: offer.description, priceKobo: offer.priceKobo, stock: offer.stock, storeName: "Daily Goods", merchantName: "Verified Merchant" }]).offers[0]!;
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

function surfaceText(messages: readonly unknown[]): string {
  const update = messages.find((message): message is { updateComponents: { components: { component: string; text?: string }[] } } => typeof message === "object" && message !== null && "updateComponents" in message);
  return (update?.updateComponents.components ?? []).flatMap((component) => component.component === "Text" && component.text ? [component.text] : []).join("\n");
}

test("AC1: chat discovery surface for the store offer shows the same facts as the store page and its references resolve", async () => {
  const { database, commerce } = fixture();
  try {
    const module = createCommerceRouteModule(commerce);
    const page = await request(module, "GET", "/s/daily-goods");
    const offer = commerce.catalogue.offersForStore("store")[0]!;
    const messages = commerceDiscoverySurface([{ offerId: offer.offerId, productName: offer.productName, category: offer.category, description: offer.description, priceKobo: offer.priceKobo, stock: offer.stock, storeName: "Daily Goods", merchantName: "Verified Merchant" }], "chat-store-offer");
    assertSurfaceReferencesResolve(messages, "store offer discovery");
    const chatText = surfaceText(messages);
    for (const fact of [offer.productName, offer.category, offer.description, `${offer.stock} available`, "Sold by Verified Merchant · Daily Goods", formatNgnKobo(125050)]) {
      assert.ok(chatText.includes(fact), `chat shows ${fact}`);
      assert.ok(page.body.includes(fact), `store page shows ${fact}`);
    }
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

test("Commerce store routes fail closed for a store whose Merchant is not verified", async () => {
  const { database, commerce } = fixture();
  try {
    commerce.directory.createMerchant({ id: "pending-merchant", name: "Pending Merchant", status: "pending" });
    commerce.directory.createStore({ id: "pending-store", merchantId: "pending-merchant", slug: "pending-goods", name: "Pending Goods", status: "active" });
    commerce.catalogue.createProduct({ id: "pending-product", name: "Unlisted Lamp", category: "Home", description: "Not yet verified." });
    commerce.catalogue.createOffer({ id: "pending-offer", productId: "pending-product", storeId: "pending-store", priceKobo: 500000, stock: 3 });
    const module = createCommerceRouteModule(commerce);
    const store = await request(module, "GET", "/s/pending-goods");
    const offer = await request(module, "GET", "/s/pending-goods/offers/pending-offer");
    assert.equal(store.status, 404);
    assert.match(store.body, /Store unavailable/);
    assert.equal(offer.status, 404);
    assert.match(offer.body, /Offer unavailable/);
    for (const body of [store.body, offer.body]) assert.doesNotMatch(body, /Pending Goods|Pending Merchant|Unlisted Lamp/);
  } finally {
    database.close();
  }
});

test("Commerce store routes fail closed for an inactive store", async () => {
  const { database, commerce } = fixture();
  try {
    commerce.directory.createStore({ id: "paused-store", merchantId: "merchant", slug: "paused-goods", name: "Paused Goods", status: "suspended" });
    commerce.catalogue.createProduct({ id: "paused-product", name: "Paused Mug", category: "Home", description: "Currently suspended." });
    commerce.catalogue.createOffer({ id: "paused-offer", productId: "paused-product", storeId: "paused-store", priceKobo: 150000, stock: 4 });
    const module = createCommerceRouteModule(commerce);
    const store = await request(module, "GET", "/s/paused-goods");
    const offer = await request(module, "GET", "/s/paused-goods/offers/paused-offer");
    assert.equal(store.status, 404);
    assert.match(store.body, /Store unavailable/);
    assert.equal(offer.status, 404);
    assert.match(offer.body, /Offer unavailable/);
    for (const body of [store.body, offer.body]) assert.doesNotMatch(body, /Paused Goods|Paused Mug/);
  } finally {
    database.close();
  }
});

test("Offer page offers the chat as its next step and no action back to the store", async () => {
  const { database, commerce } = fixture();
  try {
    const module = createCommerceRouteModule(commerce);
    const offerPage = await request(module, "GET", "/s/daily-goods/offers/offer");
    assert.equal(offerPage.status, 200);
    assert.doesNotMatch(offerPage.body, /View offer/);
    assert.match(offerPage.body, /Continue in chat for cart and checkout/);
  } finally {
    database.close();
  }
});

test("AC2: unknown-code and wrong-phone responses are byte-identical, and every tracking response is no-store", async () => {
  const { database, commerce, order } = fixture();
  try {
    const module = createCommerceRouteModule(commerce);
    const unknownCode = await request(module, "POST", "/orders/track", new URLSearchParams({ publicCode: "NOT-A-CODE", phone: "+234 801 234 5678" }).toString());
    const wrongPhone = await request(module, "POST", "/orders/track", new URLSearchParams({ publicCode: order.publicCode, phone: "08000000000" }).toString());
    const emptyPhone = await request(module, "POST", "/orders/track", new URLSearchParams({ publicCode: order.publicCode, phone: "" }).toString());
    const oversize = await request(module, "POST", "/orders/track", new URLSearchParams({ publicCode: order.publicCode, phone: "9".repeat(5000) }).toString());
    const page = await request(module, "GET", "/orders/track");
    assert.equal(wrongPhone.status, unknownCode.status);
    assert.deepEqual(wrongPhone.headers, unknownCode.headers);
    assert.equal(wrongPhone.body, unknownCode.body);
    assert.equal(emptyPhone.body, unknownCode.body);
    assert.equal(oversize.status, 400);
    assert.match(oversize.body, /could not check the order/i);
    for (const response of [unknownCode, wrongPhone, emptyPhone, oversize, page]) assert.equal(response.headers["Cache-Control"], "no-store");
  } finally {
    database.close();
  }
});

test("AC2: the matched order shows Last updated in WAT and never as a raw ISO timestamp", async () => {
  const { database, commerce, order } = fixture();
  try {
    const module = createCommerceRouteModule(commerce);
    const valid = await request(module, "POST", "/orders/track", new URLSearchParams({ publicCode: order.publicCode, phone: "+234 801 234 5678" }).toString());
    assert.ok(valid.body.includes(formatWatDateTime(order.updatedAt)));
    assert.doesNotMatch(valid.body, />[^<]*2026-10-18T/);
  } finally {
    database.close();
  }
});

test("AC2: the domain tracking lookup returns only the minimal projection, or null for any mismatch", () => {
  const { database, commerce, order } = fixture();
  try {
    const tracked = commerce.orders.trackOrder(order.publicCode, "+234 801 234 5678");
    assert.deepEqual(Object.keys(tracked ?? {}).sort(), ["publicCode", "status", "updatedAt"]);
    assert.equal(commerce.orders.trackOrder("NOT-A-CODE", "+234 801 234 5678"), null);
    assert.equal(commerce.orders.trackOrder(order.publicCode, "08000000000"), null);
    assert.equal(commerce.orders.trackOrder(order.publicCode, "no digits here"), null);
  } finally {
    database.close();
  }
});

/** Issue 27 (user decision, 18 Oct 2026): a locked lookup answers exactly like a wrong phone (no lock oracle, ADR 0075). */
test("AC2 tracking: a locked lookup returns the same bytes, status and headers as a wrong phone", async () => {
  const { database, commerce, order } = fixture();
  try {
    const module = createCommerceRouteModule(commerce);
    const form = (phone: string) => new URLSearchParams({ publicCode: order.publicCode, phone }).toString();
    const wrong = await request(module, "POST", "/orders/track", form("08000000000"));
    for (let attempt = 1; attempt < 5; attempt++) await request(module, "POST", "/orders/track", form("08000000000"));
    const lockedCorrect = await request(module, "POST", "/orders/track", form("+234 801 234 5678"));
    const lockedWrong = await request(module, "POST", "/orders/track", form("08000000000"));
    assert.equal(lockedCorrect.status, wrong.status);
    assert.deepEqual(lockedCorrect.headers, wrong.headers);
    assert.equal(lockedCorrect.body, wrong.body);
    assert.equal(lockedWrong.body, wrong.body);
    assert.doesNotMatch(lockedCorrect.body, /Order status/);
  } finally {
    database.close();
  }
});

test("Store and offer pages show the store name in the top bar, and tracking keeps the Shortlet brand", async () => {
  const { database, commerce } = fixture();
  try {
    const module = createCommerceRouteModule(commerce);
    const store = await request(module, "GET", "/s/daily-goods");
    const offer = await request(module, "GET", "/s/daily-goods/offers/offer");
    const tracking = await request(module, "GET", "/orders/track");
    assert.match(store.body, /<a class="ui-appbar__brand" href="\/">Daily Goods<\/a>/);
    assert.match(offer.body, /<a class="ui-appbar__brand" href="\/">Daily Goods<\/a>/);
    assert.match(tracking.body, /<a class="ui-appbar__brand" href="\/">Shortlet<\/a>/);
  } finally {
    database.close();
  }
});

test("The offer page shows the product name once in its heading, and the store page keeps its card headings", async () => {
  const { database, commerce } = fixture();
  try {
    const module = createCommerceRouteModule(commerce);
    const store = await request(module, "GET", "/s/daily-goods");
    const offer = await request(module, "GET", "/s/daily-goods/offers/offer");
    assert.match(offer.body, /<h1>Oat Soap<\/h1>/);
    assert.doesNotMatch(offer.body, /<h2>[^<]*Oat Soap/);
    assert.match(store.body, /<h2><a class="ui-link" href="[^"]*">Oat Soap<\/a><\/h2>/);
  } finally {
    database.close();
  }
});
