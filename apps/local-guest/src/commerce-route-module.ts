import { createHash, timingSafeEqual } from "node:crypto";
import type { HttpRequestLike, HttpResponseLike } from "../../../packages/platform-core/src/http-like.js";
import { GUEST_HTML_SECURITY_HEADERS } from "../../../packages/platform-core/src/security-headers.js";
import type { createCommercePack } from "../../../domains/commerce/src/index.js";
import { normalizePhone } from "../../../domains/commerce/src/order.js";
import { commerceDiscoveryPresentation, commerceOrderPresentation } from "../../web-agent/src/commerce-presentation.js";
import { appFrameHtml, commerceOfferHtml } from "./guest-kit.js";
import type { RouteModule } from "./guest-shell.js";
import { escapeHtml, pageShell } from "../../web/src/ui-kit.js";

type Commerce = ReturnType<typeof createCommercePack>;

function sendHtml(res: HttpResponseLike, html: string, status = 200, privatePage = false): void {
  res.writeHead(status, {
    ...GUEST_HTML_SECURITY_HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": privatePage ? "no-store" : "public, max-age=60",
    "Referrer-Policy": "no-referrer",
  });
  res.end(html);
}

function safeMatchPhone(provided: string, stored: string): boolean {
  const submitted = normalizePhone(provided);
  const expected = normalizePhone(stored);
  if (submitted.length === 0 || expected.length === 0) return false;
  const hash = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(hash(submitted), hash(expected));
}

function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function trackPage(result?: { readonly publicCode: string; readonly status: string; readonly updatedAt: string }, error?: string): string {
  const content = result === undefined
    ? `<section class="ui-panel ui-stack"><h1>Track your order</h1><p>Enter the public code and the phone number used for the order. We use both to protect your order details.</p><form method="post" action="/orders/track" class="ui-stack"><div class="ui-field"><label class="ui-field__label" for="public-code">Public order code</label><input id="public-code" name="publicCode" type="text" required maxlength="100" autocomplete="off" autocapitalize="characters" spellcheck="false"></div><div class="ui-field"><label class="ui-field__label" for="order-phone">Phone number used for the order</label><input id="order-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="32" aria-describedby="order-phone-help"><p class="ui-field__hint" id="order-phone-help">Only used to verify this order.</p></div><button class="ui-button ui-button--primary ui-button--block" type="submit">Track order</button></form></section>`
    : `<section class="ui-panel ui-stack" aria-live="polite"><h1>Order status</h1><p><strong>Public code</strong><br>${escapeHtml(result.publicCode)}</p><p><strong>Status</strong><br>${escapeHtml(result.status)}</p><p><strong>Last updated</strong><br><time datetime="${escapeHtml(result.updatedAt)}">${escapeHtml(result.updatedAt)}</time></p><a class="ui-button ui-button--secondary ui-button--block" href="/orders/track">Track another order</a></section>`;
  const alert = error === undefined ? "" : `<p class="ui-banner ui-banner--warning" role="alert">${escapeHtml(error)}</p>`;
  return pageShell({ title: "Track your order · Shop", width: "narrow", frame: appFrameHtml({ threadId: null }), body: `${content}${alert}` });
}

function readForm(req: HttpRequestLike): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 4096) {
        reject(new Error("request body too large"));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8"))));
  });
}

function storePage(commerce: Commerce, slug: string): string | null {
  const store = commerce.directory.consumerStores().find((candidate) => candidate.slug === slug);
  if (!store) return null;
  const merchant = commerce.directory.merchantById(store.merchantId);
  if (!merchant || merchant.status !== "verified") return null;
  const offers = commerce.catalogue.offersForStore(store.id).filter((offer) => offer.stock > 0);
  const presented = commerceDiscoveryPresentation(offers.map((offer) => ({
    offerId: offer.offerId,
    productName: offer.productName,
    category: offer.category,
    description: offer.description,
    priceKobo: offer.priceKobo,
    stock: offer.stock,
  })));
  const cards = presented.offers.map((offer) => commerceOfferHtml(offer, `/s/${encodeURIComponent(slug)}/offers/${encodeURIComponent(offer.offerId)}`)).join("");
  const body = `<header class="ui-page__header"><p class="ui-eyebrow">Verified store</p><h1>${escapeHtml(store.name)}</h1><p>Sold by ${escapeHtml(merchant.name)}</p></header>${cards || `<section class="ui-panel ui-empty"><h2>No offers available</h2><p>This Store has no offers to show right now.</p></section>`}<p><a class="ui-link" href="/orders/track">Track an order</a></p>`;
  return pageShell({ title: `${store.name} · Shop`, body, frame: appFrameHtml({ threadId: null }) });
}

export function createCommerceRouteModule(commerce: Commerce): RouteModule {
  return {
    name: "commerce",
    async tryHandle(req, res, url) {
      if (req.method === "GET" && url.pathname === "/orders/track") {
        sendHtml(res, trackPage(), 200, true);
        return true;
      }
      if (req.method === "POST" && url.pathname === "/orders/track") {
        try {
          const form = await readForm(req);
          const code = form.get("publicCode");
          const phone = form.get("phone");
          const order = typeof code === "string" && typeof phone === "string" && code.trim() !== ""
            ? commerce.orders.orderByPublicCode(code.trim())
            : null;
          // ADR 0075: fail closed and return one generic response for unknown codes and mismatched phones.
          if (!order || typeof phone !== "string" || !safeMatchPhone(phone, order.customerPhone)) {
            sendHtml(res, trackPage(undefined, "We could not find an order with those details. Check the code and phone number and try again."), 200, true);
            return true;
          }
          const presentation = commerceOrderPresentation({ publicCode: order.publicCode, status: order.status, updatedAt: order.updatedAt });
          sendHtml(res, trackPage(presentation), 200, true);
        } catch {
          sendHtml(res, trackPage(undefined, "We could not check the order right now. Please try again."), 400, true);
        }
        return true;
      }
      const storeMatch = /^\/s\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(url.pathname);
      if (req.method === "GET" && storeMatch) {
        const body = storePage(commerce, storeMatch[1]!);
        if (body === null) {
          sendHtml(res, pageShell({ title: "Store unavailable · Shop", width: "narrow", body: `<section class="ui-panel ui-empty"><h1>Store unavailable</h1><p>This Store could not be found.</p></section>`, frame: appFrameHtml({ threadId: null }) }), 404);
        } else sendHtml(res, body);
        return true;
      }
      const offerMatch = /^\/s\/([a-z0-9]+(?:-[a-z0-9]+)*)\/offers\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && offerMatch) {
        const store = commerce.directory.consumerStores().find((candidate) => candidate.slug === offerMatch[1]);
        const merchant = store ? commerce.directory.merchantById(store.merchantId) : null;
        const offerId = decodeSegment(offerMatch[2]!);
        const offer = store && offerId !== null && commerce.catalogue.offersForStore(store.id).find((candidate) => candidate.offerId === offerId);
        if (!store || !merchant || merchant.status !== "verified" || !offer || offer.stock <= 0) {
          sendHtml(res, pageShell({ title: "Offer unavailable · Shop", width: "narrow", body: `<section class="ui-panel ui-empty"><h1>Offer unavailable</h1><p>This offer is not available.</p></section>`, frame: appFrameHtml({ threadId: null }) }), 404);
        } else {
          const presentation = commerceDiscoveryPresentation([{ offerId: offer.offerId, productName: offer.productName, category: offer.category, description: offer.description, priceKobo: offer.priceKobo, stock: offer.stock }]).offers[0]!;
          sendHtml(res, pageShell({ title: `${presentation.productName} · ${store.name}`, width: "narrow", frame: appFrameHtml({ threadId: null }), body: `<header class="ui-page__header"><p class="ui-eyebrow">${escapeHtml(store.name)} · Sold by ${escapeHtml(merchant.name)}</p><h1>${escapeHtml(presentation.productName)}</h1></header>${commerceOfferHtml(presentation, `/s/${encodeURIComponent(store.slug)}`)}<p><a class="ui-link" href="/">Continue in chat for cart and checkout</a></p>` }));
        }
        return true;
      }
      if (req.method === "GET" && url.pathname === "/cart") {
        sendHtml(res, pageShell({ title: "Shopping cart · Shop", width: "narrow", frame: appFrameHtml({ threadId: null }), body: `<section class="ui-panel ui-empty"><h1>Your Store Cart</h1><p>Continue in the Shop chat to manage your cart and proceed to checkout.</p><a class="ui-button ui-button--primary ui-button--block" href="/">Continue in chat</a></section>` }));
        return true;
      }
      return false;
    },
  };
}
